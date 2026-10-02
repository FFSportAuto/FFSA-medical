'use strict';

// Test de bout en bout du workflow : organisateur -> médecin -> service médical.
// Nécessite une base PostgreSQL de test (TEST_DATABASE_URL).

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/ffsa_test';
process.env.MEDICAL_SERVICE_EMAILS = 'medical@ffsa.test';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const migrate = require('../src/db/migrate');
const createApp = require('../src/app');
const mailer = require('../src/lib/mailer');
const totp = require('../src/lib/totp');
const { hashPassword } = require('../src/lib/password');
const { encrypt } = require('../src/lib/crypto');

const PASSWORD = 'Motdepasse-Solide-2026';
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

let server;
let base;

// Petit client HTTP avec gestion des cookies et du jeton CSRF
function client() {
  const jar = new Map();
  let csrf = null;
  async function request(path, { method = 'GET', body } = {}) {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload;
    if (body instanceof FormData) {
      body.set('_csrf', csrf);
      payload = body;
    } else if (body) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams({ _csrf: csrf, ...body }).toString();
    }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    const m = text.match(/name="_csrf" value="([^"]+)"/);
    if (m) csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text, headers: res.headers };
  }
  return { request, get: (p) => request(p), post: (p, body) => request(p, { method: 'POST', body }) };
}

async function createUser(email, role, { withTotp = false } = {}) {
  const secret = withTotp ? totp.generateSecret() : null;
  await db.query(
    'INSERT INTO users (email, full_name, role, password_hash, totp_enabled, totp_secret_enc) VALUES ($1, $2, $3, $4, $5, $6)',
    [email, `Test ${role}`, role, await hashPassword(PASSWORD), withTotp, secret ? encrypt(secret) : null],
  );
  return secret;
}

async function login(c, email, secret) {
  await c.get('/connexion');
  const r = await c.post('/connexion', { email, password: PASSWORD });
  assert.strictEqual(r.status, 302, 'connexion');
  if (secret) {
    assert.strictEqual(r.location, '/connexion/2fa');
    await c.get('/connexion/2fa');
    const r2 = await c.post('/connexion/2fa', { code: totp.generate(secret) });
    assert.strictEqual(r2.status, 302);
    return r2;
  }
  return r;
}

const lastMail = (re) => [...mailer.outbox].reverse().find((m) => re.test(m.subject));

function accidentFormData() {
  const fd = new FormData();
  const fields = {
    event_name: 'Rallye Test des Vosges',
    event_date: '2026-09-20',
    accident_time: '14:35',
    event_location: 'Gérardmer',
    discipline: 'Rallye',
    asa: 'ASA Vosges',
    declarant_name: 'Jean Directeur',
    declarant_role: 'Directeur de course',
    declarant_phone: '06 12 34 56 78',
    declarant_email: 'dc@asa.test',
    victim_role: 'Pilote',
    victim_last_name: 'Pilote',
    victim_first_name: 'Paul',
    accident_place: 'ES3 PK 4.2',
    description: 'Sortie de route dans un virage à droite.',
    evacuation: 'Centre hospitalier',
    hospital_name: 'CHU de Nancy',
    doctor_last_name: 'Docteur',
    doctor_first_name: 'Marie',
    doctor_email: 'dr.marie@hopital.test',
    doctor_phone: '0601020304',
    certify: '1',
    signature: SIGNATURE,
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.append('accident_type', 'Sortie de route');
  fd.append('accident_type', 'Tonneau(x)');
  fd.append('attachments', new Blob([PNG], { type: 'image/png' }), 'photo.png');
  return fd;
}

test.before(async () => {
  await migrate();
  await db.query('TRUNCATE users, accident_reports, audit_log, session CASCADE');
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await db.pool.end();
});

test('workflow complet accident -> médical -> back office', async () => {
  await createUser('orga@asa.test', 'organizer');
  await createUser('orga2@asa.test', 'organizer');
  const medSecret = await createUser('medical@ffsa.test', 'medical', { withTotp: true });

  // 1. L'organisateur déclare l'accident
  const orga = client();
  await login(orga, 'orga@asa.test');
  const form = await orga.get('/organisateur/rapports/nouveau');
  assert.match(form.text, /Rapport d&#39;accident|Rapport d'accident/);

  const bad = await orga.request('/organisateur/rapports', { method: 'POST', body: new FormData() });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.text, /Champ obligatoire/);

  const created = await orga.request('/organisateur/rapports', { method: 'POST', body: accidentFormData() });
  assert.strictEqual(created.status, 302, created.text.slice(0, 500));
  const accident = await db.one('SELECT * FROM accident_reports');
  assert.match(accident.reference, /^ACC-\d{4}-\d{5}$/);
  assert.strictEqual(accident.status, 'awaiting_medical');
  // Les données sensibles ne sont pas stockées en clair
  assert.ok(!accident.data_enc.toString('latin1').includes('Pilote'));

  // 2. Notifications : médecin, organisateur, service médical — sans donnée de santé
  const invite = lastMail(/Rapport médical à compléter/);
  assert.deepStrictEqual([].concat(invite.to), ['dr.marie@hopital.test']);
  assert.ok(lastMail(/Nouveau rapport d'accident/));
  for (const m of mailer.outbox) assert.ok(!/Paul|CHU|Sortie de route/.test(m.text), 'pas de donnée sensible par e-mail');
  const link = invite.text.match(/https?:\/\/\S+\/medecin\/(\S+)/);
  const token = link[1];

  // Un autre organisateur ne peut pas voir le dossier ; l'organisateur n'a pas accès au back office
  const orga2 = client();
  await login(orga2, 'orga2@asa.test');
  assert.strictEqual((await orga2.get(`/organisateur/rapports/${accident.id}`)).status, 404);
  assert.strictEqual((await orga.get('/back-office')).status, 403);

  // 3. Le médecin ouvre le lien : vérification par code
  const doc = client();
  const landing = await doc.get(`/medecin/${token}`);
  assert.match(landing.text, /d•+@hopital\.test/);
  assert.ok(!landing.text.includes('Paul'), 'aucune donnée avant vérification');
  assert.strictEqual((await doc.post(`/medecin/${token}/verifier`, { code: '000000' })).status, 401);
  await doc.post(`/medecin/${token}/code`, {});
  const code = lastMail(/Code de vérification/).text.match(/(\d{6})/)[1];
  const verified = await doc.post(`/medecin/${token}/verifier`, { code });
  assert.strictEqual(verified.status, 302);
  const medPage = await doc.get(`/medecin/${token}`);
  assert.match(medPage.text, /Rappel de la déclaration/);
  assert.match(medPage.text, /value="Docteur"/, 'pré-remplissage');

  // 4. Le médecin transmet son rapport
  const mfd = new FormData();
  const mfields = {
    doctor_last_name: 'Docteur', doctor_first_name: 'Marie', doctor_function: 'Médecin-chef de l’épreuve',
    exam_time: '14:50', loss_of_consciousness: 'Non', gcs: '15', blood_pressure: '125/80',
    clinical_findings: 'Douleur cervicale, pas de déficit.', severity: 'Blessure modérée (hospitalisation, pronostic non engagé)',
    outcome: 'Évacuation vers un centre hospitalier', hospital_name: 'CHU de Nancy', fitness: 'Inapte pour la suite de l’épreuve',
    certify: '1', signature: SIGNATURE,
  };
  for (const [k, v] of Object.entries(mfields)) mfd.set(k, v);
  mfd.append('injured_regions', 'Rachis cervical');
  const submitted = await doc.request(`/medecin/${token}`, { method: 'POST', body: mfd });
  assert.strictEqual(submitted.status, 200, submitted.text.slice(0, 300));
  assert.match(submitted.text, /Rapport médical transmis/);
  assert.strictEqual((await db.one('SELECT status FROM accident_reports')).status, 'complete');
  assert.ok(lastMail(/Dossier complet/));
  // Le lien ne peut plus être utilisé
  assert.strictEqual((await doc.get(`/medecin/${token}`)).status, 410);

  // 5. Le service médical consulte le dossier (2FA obligatoire)
  const med = client();
  await login(med, 'medical@ffsa.test', medSecret);
  const list = await med.get('/back-office');
  assert.match(list.text, new RegExp(accident.reference));
  const detail = await med.get(`/back-office/dossiers/${accident.id}`);
  assert.match(detail.text, /Douleur cervicale/);
  assert.match(detail.text, /CHU de Nancy/);
  const att = detail.text.match(/\/pieces\/([0-9a-f-]{36})/);
  const file = await med.get(`/back-office/dossiers/${accident.id}/pieces/${att[1]}`);
  assert.strictEqual(file.status, 200);
  const csv = await med.get('/back-office/export.csv?statut=complete');
  assert.match(csv.text, /Rallye Test des Vosges/);
  assert.match(csv.text, /Rachis cervical/);
  // Le service médical n'administre pas les comptes
  assert.strictEqual((await med.get('/back-office/utilisateurs')).status, 403);

  const actions = (await db.query('SELECT action FROM audit_log')).rows.map((r) => r.action);
  for (const a of ['accident_created', 'medical_submitted', 'dossier_viewed', 'export_csv', 'attachment_downloaded']) {
    assert.ok(actions.includes(a), a);
  }
});

test('protection CSRF et 2FA imposée au back office', async () => {
  await createUser('admin@ffsa.test', 'admin');
  const c = client();
  await c.get('/connexion');
  const noCsrf = await fetch(`${base}/connexion`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=admin@ffsa.test&password=x',
  });
  assert.strictEqual(noCsrf.status, 403);

  await login(c, 'admin@ffsa.test');
  const bo = await c.get('/back-office');
  assert.strictEqual(bo.status, 302);
  assert.strictEqual(bo.location, '/compte/2fa');
});

test('verrouillage après 5 échecs', async () => {
  const c = client();
  await c.get('/connexion');
  for (let i = 0; i < 5; i++) await c.post('/connexion', { email: 'orga@asa.test', password: 'faux' });
  const r = await c.post('/connexion', { email: 'orga@asa.test', password: PASSWORD });
  assert.strictEqual(r.status, 401);
  assert.match(r.text, /verrouillé/);
});
