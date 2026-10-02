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
const { encrypt, decryptText } = require('../src/lib/crypto');

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
    if (body && body.__json) {
      headers['content-type'] = 'application/json';
      headers['x-csrf-token'] = csrf;
      payload = JSON.stringify(body.__json);
    } else if (body instanceof FormData) {
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
  return {
    request,
    get: (p) => request(p),
    post: (p, body) => request(p, { method: 'POST', body }),
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    json: (p, obj) => request(p, { method: 'POST', body: { __json: obj } }),
  };
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

const accidentFields = (form) => form.sections.flatMap((x) => x.fields);
const casualties = accidentFields(require('../src/forms/accident')).find((f) => f.name === 'casualties');
const upperLimbs = accidentFields(require('../src/forms/medical')).find((f) => f.name === 'upper_limbs');
const { cellName } = require('../src/forms/engine');

function accidentFormData() {
  const fd = new FormData();
  const fields = {
    doctor_first_name: 'Marie',
    doctor_last_name: 'Docteur',
    doctor_email: 'dr.marie@hopital.test',
    doctor_phone: '06 01 02 03 04',
    summary_victim_last_name: 'Pilote',
    summary_victim_first_name: 'Paul',
    accident_date: '2026-09-20',
    accident_time: '14:35',
    circumstances: 'Sortie de route dans un virage à droite.',
    hospitalised_count: '2',
    event_name: 'Rallye Test des Vosges',
    event_location: 'Gérardmer',
    discipline: 'Rallye',
    event_date: '2026-09-20',
    vehicle1_driver_last_name: 'Pilote',
    vehicle1_driver_first_name: 'Paul',
    vehicle1_vehicle_type: 'Voiture de tourisme (y compris SUV et 4x4)',
    person1_last_name: 'Spectateur',
    person1_first_name: 'Jean',
    author_first_name: 'Jean',
    author_last_name: 'Directeur',
    author_signature: SIGNATURE,
    [cellName(casualties, 0, 0)]: '1',
    [cellName(casualties, 5, 0)]: '1',
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.append('weather', 'Nuageux');
  fd.append('weather', 'Autre');
  fd.set('weather_other', 'Vent fort');
  fd.append('diagram', new Blob([PNG], { type: 'image/png' }), 'schema.png');
  return fd;
}

function medicalFormData(last, first, classification) {
  const fd = new FormData();
  const fields = {
    patient_last_name: last,
    patient_first_name: first,
    bp: '125/80',
    glasgow: '15',
    diagnosis: 'Entorse cervicale probable.',
    classification,
    unfit: 'Non (pas de suspension de licence)',
    current_event: 'Inapte à reprendre',
    doctor_name: 'Marie Docteur',
    hospital: 'CHU de Nancy',
    [cellName(upperLimbs, 1, 0)]: 'L',
  };
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  fd.append('spine', 'Cervical');
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

  // Brouillon enregistré automatiquement puis repris
  const saved = await orga.json('/organisateur/brouillon', { event_name: 'Brouillon en cours', weather: ['Nuageux'] });
  assert.strictEqual(saved.status, 200, saved.text.slice(0, 200));
  assert.ok(JSON.parse(saved.text).savedAt);
  const resumed = await orga.get('/organisateur/rapports/nouveau');
  assert.match(resumed.text, /value="Brouillon en cours"/);
  assert.match(resumed.text, /Brouillon repris/);

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
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM drafts')).n, 0, 'brouillon supprimé après envoi');

  // 2. Notifications : médecin, organisateur, service médical — sans donnée de santé
  const invite = lastMail(/Rapport médical à compléter/);
  assert.deepStrictEqual([].concat(invite.to), ['dr.marie@hopital.test']);
  assert.ok(lastMail(/Nouveau rapport d'accident/));
  for (const m of mailer.outbox) assert.ok(!/Paul|CHU|Sortie de route/.test(m.text), 'pas de donnée sensible par e-mail');
  const token = invite.text.match(/https?:\/\/\S+\/medecin\/(\S+)/)[1];
  // Le lien est aussi envoyé par SMS au portable du médecin
  const smsInvite = mailer.outbox.filter((m) => m.sms).pop();
  assert.strictEqual(smsInvite.to, '+33601020304');
  assert.ok(smsInvite.text.includes(`/medecin/${token}`));

  // Un autre organisateur ne peut pas voir le dossier ; l'organisateur n'a pas accès au back office
  const orga2 = client();
  await login(orga2, 'orga2@asa.test');
  assert.strictEqual((await orga2.get(`/organisateur/rapports/${accident.id}`)).status, 404);
  assert.strictEqual((await orga.get('/back-office')).status, 403);

  // 3. Le médecin ouvre le lien : vérification par code
  const doc = client();
  const landing = await doc.get(`/medecin/${token}`);
  assert.match(landing.text, /d•+@hopital\.test/);
  assert.match(landing.text, /03 04/, 'portable masqué');
  assert.ok(!landing.text.includes('Paul'), 'aucune donnée avant vérification');
  assert.strictEqual((await doc.get(`/medecin/${token}/patient`)).status, 302, 'formulaire inaccessible sans code');
  assert.strictEqual((await doc.post(`/medecin/${token}/verifier`, { code: '000000' })).status, 401);
  await doc.post(`/medecin/${token}/code`, {});
  const code = lastMail(/Code de vérification/).text.match(/(\d{6})/)[1];
  assert.ok(mailer.outbox.filter((m) => m.sms).pop().text.includes(code), 'code aussi envoyé par SMS');
  assert.strictEqual((await doc.post(`/medecin/${token}/verifier`, { code })).status, 302);
  const dossier = await doc.get(`/medecin/${token}`);
  assert.match(dossier.text, /Rappel de la déclaration/);
  // Personnes déclarées par l'organisateur (la synthèse et le pilote n°1 sont la même personne)
  assert.match(dossier.text, /Pilote Paul/);
  assert.match(dossier.text, /Spectateur Jean/);
  assert.strictEqual((dossier.text.match(/patient\?p=/g) || []).length, 3, '2 personnes + « autre patient »');
  const medPage = await doc.get(`/medecin/${token}/patient?p=vehicle1`);
  assert.match(medPage.text, /value="Marie Docteur"/, 'pré-remplissage médecin');
  assert.match(medPage.text, /value="Rallye Test des Vosges"/, 'pré-remplissage épreuve');
  assert.match(medPage.text, /id="f_patient_last_name" name="patient_last_name" type="text" value="Pilote"/, 'pré-remplissage patient');
  assert.match(medPage.text, /Patient déclaré par l'organisateur|Patient déclaré par l&#39;organisateur/);

  // Brouillon du médecin, propre à chaque patient
  assert.strictEqual((await doc.json(`/medecin/${token}/brouillon?p=vehicle1`, { patient_last_name: 'Pilote', diagnosis: 'Brouillon diagnostic' })).status, 200);
  assert.match((await doc.get(`/medecin/${token}/patient?p=vehicle1`)).text, /Brouillon diagnostic/);
  assert.doesNotMatch((await doc.get(`/medecin/${token}/patient?p=person1`)).text, /Brouillon diagnostic/);

  // Clôture impossible sans rapport
  assert.match((await doc.post(`/medecin/${token}/cloturer`, {})).location, /vide=1/);

  // 4. Le médecin transmet un rapport par patient, puis clôture
  for (const [last, first, cls, ref] of [['Pilote', 'Paul', "2 : transfert à l'hôpital", 'vehicle1'], ['Spectateur', 'Jean', '1 : traitement sur place', 'person1']]) {
    await doc.get(`/medecin/${token}/patient?p=${ref}`);
    const r = await doc.request(`/medecin/${token}/patient?p=${ref}`, { method: 'POST', body: medicalFormData(last, first, cls) });
    assert.strictEqual(r.status, 302, r.text.slice(0, 400));
  }
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM medical_reports')).n, 2);
  assert.deepStrictEqual((await db.query('SELECT patient_ref FROM medical_reports ORDER BY created_at')).rows.map((r) => r.patient_ref), ['vehicle1', 'person1']);
  assert.strictEqual((await db.one('SELECT count(*)::int AS n FROM drafts')).n, 0, 'brouillon médecin supprimé après envoi');
  assert.strictEqual((await db.one('SELECT status FROM accident_reports')).status, 'awaiting_medical');
  const list = await doc.get(`/medecin/${token}`);
  assert.strictEqual((list.text.match(/Rapport saisi/g) || []).length, 2);
  const closed = await doc.post(`/medecin/${token}/cloturer`, {});
  assert.match(closed.text, /Rapport médical transmis/);
  assert.strictEqual((await db.one('SELECT status FROM accident_reports')).status, 'complete');
  assert.ok(lastMail(/Dossier complet/));
  // Le lien ne peut plus être utilisé
  assert.strictEqual((await doc.get(`/medecin/${token}`)).status, 410);

  // 5. Le service médical consulte le dossier (2FA obligatoire)
  const med = client();
  await login(med, 'medical@ffsa.test', medSecret);
  const boList = await med.get('/back-office');
  assert.match(boList.text, new RegExp(accident.reference));
  const detail = await med.get(`/back-office/dossiers/${accident.id}`);
  assert.match(detail.text, /Entorse cervicale probable/);
  assert.match(detail.text, /Patient 2 – Spectateur Jean/);
  assert.match(detail.text, /Vent fort/);
  const att = detail.text.match(/\/pieces\/([0-9a-f-]{36})/);
  const file = await med.get(`/back-office/dossiers/${accident.id}/pieces/${att[1]}`);
  assert.strictEqual(file.status, 200);
  const csv = await med.get('/back-office/export.csv?statut=complete');
  assert.match(csv.text, /Rallye Test des Vosges/);
  assert.match(csv.text, /Cervical/);
  assert.strictEqual(csv.text.trim().split('\r\n').length, 3, 'une ligne par patient');
  // Téléchargement PDF au format du modèle FFSA, réservé au back office
  for (const kind of ['accident', 'medical', 'complet']) {
    const res = await fetch(`${base}/back-office/dossiers/${accident.id}/pdf/${kind}`, { headers: { cookie: med.cookie() } });
    assert.strictEqual(res.status, 200, kind);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), new RegExp(`${accident.reference}-`));
    assert.strictEqual(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }
  assert.strictEqual((await orga.get(`/back-office/dossiers/${accident.id}/pdf/complet`)).status, 403);

  // Suivi : statut, attribution, notes internes
  const medUser = await db.one("SELECT id FROM users WHERE email = 'medical@ffsa.test'");
  await med.get(`/back-office/dossiers/${accident.id}`);
  assert.strictEqual((await med.post(`/back-office/dossiers/${accident.id}/suivi`, { processing_status: 'en_cours', assigned_to: medUser.id })).status, 302);
  assert.strictEqual((await med.post(`/back-office/dossiers/${accident.id}/notes`, { note: 'Appeler le pilote à J+7' })).status, 302);
  const followed = await med.get(`/back-office/dossiers/${accident.id}`);
  assert.match(followed.text, /Appeler le pilote à J\+7/);
  assert.match(followed.text, /value="en_cours" selected/);
  assert.match((await med.get('/back-office?attribue=moi')).text, new RegExp(accident.reference));
  assert.doesNotMatch((await med.get('/back-office?suivi=clos')).text, new RegExp(accident.reference));
  assert.ok(!(await db.one('SELECT body_enc FROM case_notes')).body_enc.toString('latin1').includes('Appeler'), 'note chiffrée');

  // Le service médical n'administre pas les comptes
  assert.strictEqual((await med.get('/back-office/utilisateurs')).status, 403);

  const actions = (await db.query('SELECT action FROM audit_log')).rows.map((r) => r.action);
  for (const a of ['accident_created', 'medical_submitted', 'dossier_viewed', 'export_csv', 'attachment_downloaded', 'pdf_downloaded', 'case_updated', 'note_added']) {
    assert.ok(actions.includes(a), a);
  }
});

test('dossier en retard et transfert à un confrère', async () => {
  const orga = client();
  await login(orga, 'orga@asa.test');
  await orga.get('/organisateur/rapports/nouveau');
  assert.strictEqual((await orga.request('/organisateur/rapports', { method: 'POST', body: accidentFormData() })).status, 302);
  const late = await db.one('SELECT * FROM accident_reports ORDER BY created_at DESC LIMIT 1');
  await db.query("UPDATE accident_reports SET created_at = now() - interval '3 days' WHERE id = $1", [late.id]);

  const med = client();
  const secret = decryptText((await db.one("SELECT totp_secret_enc FROM users WHERE email = 'medical@ffsa.test'")).totp_secret_enc);
  await login(med, 'medical@ffsa.test', secret);
  const overdue = await med.get('/back-office?retard=1');
  assert.match(overdue.text, new RegExp(late.reference));
  assert.match(overdue.text, /En retard/);
  assert.match((await med.get(`/back-office/dossiers/${late.id}`)).text, /Rapport médical en retard/);

  // Le médecin transmet à un confrère : ancien lien désactivé, nouveau lien envoyé
  const token = lastMail(/Rapport médical à compléter – dossier/).text.match(/\/medecin\/(\S+)/)[1];
  const doc = client();
  await doc.get(`/medecin/${token}`);
  await doc.post(`/medecin/${token}/code`, {});
  await doc.post(`/medecin/${token}/verifier`, { code: lastMail(/Code de vérification/).text.match(/(\d{6})/)[1] });
  await doc.get(`/medecin/${token}`);
  const tr = await doc.post(`/medecin/${token}/transferer`, { email: 'confrere@hopital.test', phone: '0611223344' });
  assert.match(tr.text, /Demande transmise/);
  assert.strictEqual((await doc.get(`/medecin/${token}`)).status, 410);
  const fwd = lastMail(/transmis par un confrère/);
  assert.deepStrictEqual([].concat(fwd.to), ['confrere@hopital.test']);
  const newToken = fwd.text.match(/\/medecin\/(\S+)/)[1];
  assert.strictEqual((await fetch(`${base}/medecin/${newToken}`)).status, 200);
});

test('la boîte mail de démonstration est désactivée hors mode démo', async () => {
  const r = await fetch(`${base}/demo/emails`);
  assert.strictEqual(r.status, 404);
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
