'use strict';

// Comptes organisateurs autonomes : connexion par compte licencié (OpenID Connect) et inscription libre.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/ffsa_test';
process.env.APPROVER_EMAILS = 'validation@ffsa.test';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const config = require('../src/config');
const db = require('../src/db');
const migrate = require('../src/db/migrate');
const createApp = require('../src/app');
const mailer = require('../src/lib/mailer');
const sso = require('../src/lib/sso');
const totp = require('../src/lib/totp');
const { hashPassword } = require('../src/lib/password');
const { encrypt } = require('../src/lib/crypto');
const { createDemoIdp } = require('../src/sso-demo-idp');

const PASSWORD = 'Motdepasse-Solide-2026';
let app, idp, base, idpBase;

function client() {
  const jar = new Map();
  let csrf = null;
  async function request(url, { method = 'GET', body } = {}) {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let payload;
    if (body) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams({ _csrf: csrf, ...body }).toString();
    }
    const res = await fetch(url.startsWith('http') ? url : base + url, { method, headers, body: payload, redirect: 'manual' });
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
  return { get: (u) => request(u), post: (u, body) => request(u, { method: 'POST', body }) };
}

const lastMail = (re) => [...mailer.outbox].reverse().find((m) => re.test(m.subject));

// Double authentification obligatoire : code de connexion envoyé par e-mail aux organisateurs
async function completeEmailCode(c, r) {
  if (r.location !== '/connexion/2fa') return r;
  await c.get('/connexion/2fa');
  const code = lastMail(/code de connexion/).text.match(/(\d{6})/)[1];
  return c.post('/connexion/2fa', { code });
}

// Parcours complet de connexion par le portail licencié (simulé) ; renvoie la réponse finale de l'application
async function ssoLogin(c, sub) {
  await c.get('/connexion');
  const start = await c.get('/connexion/sso');
  assert.strictEqual(start.status, 302);
  const auth = new URL(start.location);
  assert.strictEqual(auth.origin, idpBase);
  const params = Object.fromEntries(auth.searchParams);
  const consent = await fetch(`${idpBase}/sso/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, sub }).toString(),
    redirect: 'manual',
  });
  const back = new URL(consent.headers.get('location'));
  const r = await c.get(back.pathname + back.search);
  return r.status === 302 ? completeEmailCode(c, r) : r;
}

test.before(async () => {
  await migrate();
  await db.query("BEGIN; SET LOCAL ffsa.audit_maintenance = 'on'; TRUNCATE users, accident_reports, audit_log, session, drafts CASCADE; COMMIT;");
  app = createApp().listen(0);
  base = `http://127.0.0.1:${app.address().port}`;
  const idpApp = express();
  idpApp.use(express.urlencoded({ extended: false }));
  idp = idpApp.listen(0);
  idpBase = `http://127.0.0.1:${idp.address().port}`;
  idpApp.use('/sso', createDemoIdp({ publicBase: () => `${idpBase}/sso`, internalIssuer: () => `${idpBase}/sso`, clientId: 'ffsa-test', clientSecret: 'secret-test' }));
  config.baseUrl = base;
  Object.assign(config.oidc, { issuer: `${idpBase}/sso`, clientId: 'ffsa-test', clientSecret: 'secret-test', requiredClaim: '', requiredValues: [] });
  sso.resetForTests();
});

test.after(async () => {
  app.close();
  idp.close();
  await db.pool.end();
});

test('connexion avec le compte licencié : compte créé automatiquement puis réutilisé', async () => {
  const login = await client().get('/connexion');
  assert.match(login.text, /compte licencié FFSA/);
  assert.match(login.text, /href="\/inscription"/);

  const c = client();
  const res = await ssoLogin(c, 'lic-201501');
  assert.strictEqual(res.status, 302, res.text.slice(0, 300));
  assert.strictEqual(res.location, '/organisateur');
  const user = await db.one("SELECT * FROM users WHERE email = 'camille.laurent@asa-demo.fr'");
  assert.strictEqual(user.auth_source, 'sso');
  assert.strictEqual(user.license_number, '201501');
  assert.strictEqual(user.organization, 'ASA Démo Ouest', 'ASA reprise du compte licencié');
  assert.strictEqual(user.approval_status, 'approved');
  const home = await c.get('/organisateur');
  assert.strictEqual(home.status, 200);
  assert.match(home.text, /class="who-name">Camille Laurent</, 'nom dans le menu');
  assert.match(home.text, /class="who-org">ASA Démo Ouest</, 'ASA dans le menu');
  assert.match((await c.get('/organisateur/rapports/nouveau')).text, /id="f_asa" name="asa" type="text" value="ASA Démo Ouest"/, 'ASA pré-remplie');

  await ssoLogin(client(), 'lic-201501');
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM users WHERE email = 'camille.laurent@asa-demo.fr'")).n, 1);
  // Un jeton rejoué ou falsifié est refusé
  assert.strictEqual((await client().get('/connexion/sso/retour?code=faux&state=faux')).status, 401);
});

test('restriction facultative par profil licencié', async () => {
  Object.assign(config.oidc, { requiredClaim: 'roles', requiredValues: ['organisateur'] });
  try {
    const refused = await ssoLogin(client(), 'lic-178842');
    assert.strictEqual(refused.status, 401);
    assert.match(refused.text, /profil licencié ne permet pas/);
  } finally {
    Object.assign(config.oidc, { requiredClaim: '', requiredValues: [] });
  }
});

test("un compte du back office n'est jamais rattaché par SSO", async () => {
  await db.query(
    "INSERT INTO users (email, full_name, role, password_hash) VALUES ('karim.benali@asa-demo.fr', 'Staff', 'medical', $1)",
    [await hashPassword(PASSWORD)],
  );
  const res = await ssoLogin(client(), 'lic-178842');
  assert.strictEqual(res.status, 409);
  assert.strictEqual((await db.one("SELECT sso_subject FROM users WHERE email = 'karim.benali@asa-demo.fr'")).sso_subject, null);
});

test('inscription libre : confirmation e-mail, validation FFSA, puis connexion', async () => {
  const secret = totp.generateSecret();
  await db.query(
    "INSERT INTO users (email, full_name, role, password_hash, totp_enabled, totp_secret_enc) VALUES ('valideur@ffsa.test', 'Valideur FFSA', 'medical', $1, true, $2)",
    [await hashPassword(PASSWORD), encrypt(secret)],
  );
  const form = {
    last_name: 'Martin', first_name: 'Lucie', email: 'lucie.martin@club.test', phone: '06 12 34 56 78',
    organization: 'Club auto du Lac', job_title: 'Directeur de course', license_number: '', message: 'Slalom du Lac en mai',
    password: PASSWORD, confirm: PASSWORD, terms: '1',
  };
  const c = client();
  await c.get('/inscription');
  const invalid = await c.post('/inscription', { ...form, email: 'x', terms: '' });
  assert.strictEqual(invalid.status, 400);
  assert.match(invalid.text, /Adresse e-mail invalide/);
  const done = await c.post('/inscription', form);
  assert.match(done.text, /Vérifiez votre boîte mail/);
  const user = await db.one("SELECT * FROM users WHERE email = 'lucie.martin@club.test'");
  assert.strictEqual(user.approval_status, 'pending');
  assert.strictEqual(user.role, 'organizer');

  // Connexion refusée tant que l'adresse n'est pas confirmée (un nouveau lien est envoyé)
  const l1 = client();
  await l1.get('/connexion');
  assert.match((await l1.post('/connexion', { email: form.email, password: PASSWORD })).text, /Confirmez d’abord votre adresse/);
  const link = lastMail(/Confirmez votre adresse/).text.match(/\/inscription\/confirmer\/\S+/)[0];
  assert.match((await client().get(link)).text, /Adresse confirmée/);
  assert.deepStrictEqual([].concat(lastMail(/demande d'accès organisateur/).to), ['validation@ffsa.test']);

  // En attente de validation
  const l2 = client();
  await l2.get('/connexion');
  assert.match((await l2.post('/connexion', { email: form.email, password: PASSWORD })).text, /en cours de validation/);

  // Validation par le service médical
  const v = client();
  await v.get('/connexion');
  await v.post('/connexion', { email: 'valideur@ffsa.test', password: PASSWORD });
  await v.get('/connexion/2fa');
  await v.post('/connexion/2fa', { code: totp.generate(secret) });
  const list = await v.get('/back-office/demandes');
  assert.match(list.text, /Lucie Martin/);
  assert.match(list.text, /Slalom du Lac en mai/);
  assert.match((await v.get('/back-office')).text, /class="count">1</, 'compteur dans le menu');
  assert.strictEqual((await v.post(`/back-office/demandes/${user.id}/valider`, {})).status, 302);
  assert.ok(lastMail(/compte organisateur est activé/));

  const l3 = client();
  await l3.get('/connexion');
  const ok = await completeEmailCode(l3, await l3.post('/connexion', { email: form.email, password: PASSWORD }));
  assert.strictEqual(ok.location, '/organisateur');

  // Refus d'une autre demande, avec motif
  const c2 = client();
  await c2.get('/inscription');
  await c2.post('/inscription', { ...form, email: 'refus@club.test', first_name: 'Paul' });
  await client().get(lastMail(/Confirmez votre adresse/).text.match(/\/inscription\/confirmer\/\S+/)[0]);
  const refused = await db.one("SELECT id FROM users WHERE email = 'refus@club.test'");
  await v.get('/back-office/demandes');
  await v.post(`/back-office/demandes/${refused.id}/refuser`, { note: 'Structure inconnue' });
  assert.match(lastMail(/Votre demande de compte organisateur/).text, /Structure inconnue/);
  const l4 = client();
  await l4.get('/connexion');
  assert.match((await l4.post('/connexion', { email: 'refus@club.test', password: PASSWORD })).text, /pas été acceptée/);

  // Adresse déjà connue : même réponse, aucun doublon, e-mail d'information
  const c3 = client();
  await c3.get('/inscription');
  assert.match((await c3.post('/inscription', form)).text, /Vérifiez votre boîte mail/);
  assert.strictEqual((await db.one("SELECT count(*)::int AS n FROM users WHERE email = 'lucie.martin@club.test'")).n, 1);
  assert.ok(lastMail(/déjà un compte/));

  // Robot (champ piège rempli) : rien n'est créé
  const c4 = client();
  await c4.get('/inscription');
  await c4.post('/inscription', { ...form, email: 'robot@spam.test', website: 'http://spam' });
  assert.strictEqual(await db.one("SELECT id FROM users WHERE email = 'robot@spam.test'"), null);
});
