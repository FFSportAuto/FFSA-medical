'use strict';

// Mesures de sécurité et de conformité : double authentification, séparation des rôles,
// journal en ajout seul, durée de conservation, rotation de clé, antivirus, export pseudonymisé.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/ffsa_test';

const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const config = require('../src/config');
const db = require('../src/db');
const migrate = require('../src/db/migrate');
const createApp = require('../src/app');
const mailer = require('../src/lib/mailer');
const totp = require('../src/lib/totp');
const reports = require('../src/services/reports');
const rotateKey = require('../scripts/rotate-key');
const { hashPassword } = require('../src/lib/password');
const { encrypt, decryptJson, keyIdOf } = require('../src/lib/crypto');
const fixture = require('./fixtures/dossier-exemple');

const PASSWORD = 'Motdepasse-Solide-2026';
let server, base, accident, organizer;

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
    return { status: res.status, location: res.headers.get('location'), text };
  }
  return { request, get: (p) => request(p), post: (p, b) => request(p, { method: 'POST', body: b }) };
}

const lastCode = () => [...mailer.outbox].reverse().find((m) => /code de connexion/.test(m.subject)).text.match(/(\d{6})/)[1];

async function staff(email, role) {
  const secret = totp.generateSecret();
  await db.query('INSERT INTO users (email, full_name, role, password_hash, totp_enabled, totp_secret_enc) VALUES ($1, $2, $3, $4, true, $5)',
    [email, `Test ${role}`, role, await hashPassword(PASSWORD), encrypt(secret)]);
  const c = client();
  await c.get('/connexion');
  await c.post('/connexion', { email, password: PASSWORD });
  await c.get('/connexion/2fa');
  assert.strictEqual((await c.post('/connexion/2fa', { code: totp.generate(secret) })).status, 302);
  return c;
}

test.before(async () => {
  await migrate();
  await db.query("BEGIN; SET LOCAL ffsa.audit_maintenance = 'on'; TRUNCATE users, accident_reports, audit_log, session, drafts CASCADE; COMMIT;");
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  organizer = await db.one(
    "INSERT INTO users (email, full_name, role, password_hash, organization) VALUES ('orga@asa.test', 'Orga Test', 'organizer', $1, 'ASA Test') RETURNING *",
    [await hashPassword(PASSWORD)],
  );
  accident = await reports.createAccidentReport(organizer, fixture.accident.data, {});
  const request = await reports.findRequestByToken('x'.repeat(30)); // aucune : on passe par la base
  assert.strictEqual(request, null);
  const req = await db.one(
    `SELECT mr.*, ar.reference, ar.event_name FROM medical_requests mr JOIN accident_reports ar ON ar.id = mr.accident_id WHERE ar.id = $1`,
    [accident.id],
  );
  await reports.addMedicalReport(req, fixture.medicalReports[0].data, {}, 'vehicle1');
});

test.after(async () => {
  server.close();
  await db.pool.end();
});

test('double authentification obligatoire pour les organisateurs (code par e-mail)', async () => {
  const c = client();
  await c.get('/connexion');
  const r = await c.post('/connexion', { email: 'orga@asa.test', password: PASSWORD });
  assert.strictEqual(r.location, '/connexion/2fa');
  assert.match((await c.get('/connexion/2fa')).text, /o•+@asa\.test/);
  // Sans le code, aucun accès
  assert.strictEqual((await c.get('/organisateur')).status, 302);
  assert.strictEqual((await c.post('/connexion/2fa', { code: '000000' })).status, 401);
  const ok = await c.post('/connexion/2fa', { code: lastCode() });
  assert.strictEqual(ok.location, '/organisateur');
  assert.strictEqual((await c.get('/organisateur')).status, 200);

  // Code épuisé après 5 essais, même correct ensuite
  const c2 = client();
  await c2.get('/connexion');
  await c2.post('/connexion', { email: 'orga@asa.test', password: PASSWORD });
  await c2.get('/connexion/2fa');
  const code = lastCode();
  for (let i = 0; i < 5; i++) await c2.post('/connexion/2fa', { code: '111111' });
  const blocked = await c2.post('/connexion/2fa', { code });
  assert.strictEqual(blocked.status, 401);
  assert.match(blocked.text, /Trop d’essais/);
  // Un nouveau code fonctionne
  await c2.post('/connexion/2fa/renvoyer', {});
  await c2.get('/connexion/2fa');
  assert.strictEqual((await c2.post('/connexion/2fa', { code: lastCode() })).location, '/organisateur');
});

test("l'administrateur n'a aucun accès aux données de santé", async () => {
  const admin = await staff('admin@ffsa.test', 'admin');
  assert.strictEqual((await admin.get('/back-office')).location, '/back-office/utilisateurs');
  for (const path of [`/back-office/dossiers/${accident.id}`, `/back-office/dossiers/${accident.id}/pdf/complet`, '/back-office/export.csv', '/back-office/export-pseudonymise.csv']) {
    assert.strictEqual((await admin.get(path)).status, 403, path);
  }
  for (const path of ['/back-office/utilisateurs', '/back-office/audit', '/back-office/demandes']) {
    assert.strictEqual((await admin.get(path)).status, 200, path);
  }
  const page = await admin.get('/back-office/utilisateurs');
  assert.doesNotMatch(page.text, /href="\/back-office"[^/]/, 'pas de lien « Dossiers » dans le menu');

  const med = await staff('medecin@ffsa.test', 'medical');
  assert.strictEqual((await med.get(`/back-office/dossiers/${accident.id}`)).status, 200);
  assert.strictEqual((await med.get('/back-office/utilisateurs')).status, 403);
});

test('export statistique pseudonymisé : aucune donnée directement identifiante', async () => {
  const med = await staff('medecin2@ffsa.test', 'medical');
  const csv = (await med.get('/back-office/export-pseudonymise.csv')).text;
  for (const s of ['Girard', 'Thomas', 'Moreau', 'exemple.fr', '06 11', '254781', 'Trophée', 'Poitiers', 'clavicule droite', 'data:image']) {
    assert.ok(!csv.includes(s), `donnée identifiante exportée : ${s}`);
  }
  assert.match(csv, /Circuit asphalte/);
  assert.match(csv, /2026-10/, 'dates réduites au mois');
  assert.match(csv, /;"35";/, 'âge calculé');
  assert.match(csv.split('\r\n')[1], /^"[0-9a-f]{12}"/, 'pseudonyme');
  assert.ok(!csv.includes(accident.reference));
});

test("journal d'audit en ajout seul", async () => {
  await assert.rejects(db.query("UPDATE audit_log SET action = 'falsifie'"), /ajout seul/);
  await assert.rejects(db.query('DELETE FROM audit_log'), /ajout seul/);
  await assert.rejects(db.query('TRUNCATE audit_log'), /ajout seul/);
});

test('rotation de la clé de chiffrement', async () => {
  const saved = config.encryption;
  try {
    const k2 = crypto.randomBytes(32);
    config.encryption = { keys: new Map([...saved.keys, [2, k2]]), currentId: 2 };
    const before = (await db.one('SELECT data_enc FROM medical_reports')).data_enc;
    assert.strictEqual(keyIdOf(before), saved.currentId);
    assert.ok((await rotateKey({ log: () => {} })) > 0);
    const after = (await db.one('SELECT data_enc FROM medical_reports')).data_enc;
    assert.strictEqual(keyIdOf(after), 2);
    // L'ancienne clé peut être retirée : tout reste lisible avec la nouvelle seule
    config.encryption = { keys: new Map([[2, k2]]), currentId: 2 };
    assert.strictEqual(decryptJson(after).patient_last_name, 'Girard');
    assert.strictEqual(await rotateKey({ log: () => {} }), 0);
    // Retour à la clé d'origine pour les tests suivants
    config.encryption = { keys: new Map([...saved.keys, [2, k2]]), currentId: saved.currentId };
    await rotateKey({ log: () => {} });
  } finally {
    config.encryption = saved;
  }
});

test('antivirus : fichier infecté bloqué, antivirus injoignable = refus', async () => {
  // Faux démon clamd : signale « EICAR » comme virus
  const clamd = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.subarray(-4).equals(Buffer.alloc(4))) {
        socket.end(buf.includes(Buffer.from('EICAR')) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
      }
    });
  }).listen(0);
  const port = clamd.address().port;
  const saved = { ...config.antivirus };
  const png = (extra) => new Blob([Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from(extra)])], { type: 'image/png' });
  async function upload(file) {
    const c = client();
    await c.get('/connexion');
    await c.post('/connexion', { email: 'orga@asa.test', password: PASSWORD });
    await c.get('/connexion/2fa');
    await c.post('/connexion/2fa', { code: lastCode() });
    await c.get('/organisateur/rapports/nouveau');
    const fd = new FormData();
    for (const [k, v] of Object.entries({ doctor_first_name: 'A', doctor_last_name: 'B', doctor_email: 'a@b.test', doctor_phone: '0601020304', accident_date: '2026-10-01', event_name: 'Test', event_date: '2026-10-01', author_first_name: 'J', author_last_name: 'M' })) fd.set(k, v);
    fd.append('diagram', file, 'photo.png');
    return c.request('/organisateur/rapports', { method: 'POST', body: fd });
  }
  try {
    Object.assign(config.antivirus, { host: '127.0.0.1', port });
    const infected = await upload(png('X5O!P%@AP EICAR'));
    assert.strictEqual(infected.status, 400);
    assert.match(infected.text, /bloqué par l&#39;antivirus|bloqué par l'antivirus/);
    assert.strictEqual((await upload(png('propre'))).status, 302);
    clamd.close();
    Object.assign(config.antivirus, { port: 1 }); // injoignable
    const down = await upload(png('propre'));
    assert.strictEqual(down.status, 400);
    assert.match(down.text, /momentanément indisponible/);
  } finally {
    Object.assign(config.antivirus, saved);
    clamd.close();
  }
});

test('durée de conservation : suppression automatique après 10 ans', async () => {
  const old = await reports.createAccidentReport(organizer, { ...fixture.accident.data, event_name: 'Ancien' }, {});
  await db.query("UPDATE accident_reports SET created_at = now() - interval '10 years 1 day' WHERE id = $1", [old.id]);
  const purged = await reports.purgeExpired();
  assert.strictEqual(purged, 1);
  assert.strictEqual(await db.one('SELECT id FROM accident_reports WHERE id = $1', [old.id]), null);
  assert.ok(await db.one('SELECT id FROM accident_reports WHERE id = $1', [accident.id]), 'dossier récent conservé');
  const log = await db.one("SELECT details FROM audit_log WHERE action = 'retention_purge'");
  assert.deepStrictEqual(log.details.references, [old.reference]);
  const med = await staff('medecin3@ffsa.test', 'medical');
  assert.match((await med.get(`/back-office/dossiers/${accident.id}`)).text, /Suppression prévue le/);
});

test('page « Données personnelles » publique et liée depuis le pied de page', async () => {
  const page = await client().get('/donnees-personnelles');
  assert.strictEqual(page.status, 200);
  assert.match(page.text, /10 ans/);
  assert.match(page.text, /Texte provisoire/);
  assert.match((await client().get('/connexion')).text, /href="\/donnees-personnelles"/);
});

test('le mode démo refuse de démarrer en production', () => {
  const r = spawnSync(process.execPath, ['src/server.js'], {
    env: { ...process.env, NODE_ENV: 'production', DEMO_MODE: 'true', DATABASE_URL: process.env.DATABASE_URL, SESSION_SECRET: 'x'.repeat(40), DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /DEMO_MODE est interdit en production/);
});
