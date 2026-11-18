/* Démo interactive : simule le serveur dans le navigateur à partir des vrais gabarits EJS,
   formulaires et règles de validation de l'application. Données fictives, stockées dans ce navigateur. */
(function () {
  'use strict';

  // ---------- Modules de l'application (formulaires, moteur, e-mails) ----------
  var cache = {};
  function req(name) {
    if (cache[name]) return cache[name].exports;
    var m = { exports: {} };
    cache[name] = m;
    MODULES[name](m, m.exports, req);
    return m.exports;
  }
  var engine = req('engine');
  var accidentForm = req('accident');
  var medicalForm = req('medical');
  var mailTemplates = req('mail-templates');
  var smsTemplates = req('sms-templates');
  var declaredPersons = req('patients').declaredPersons;
  var signupRules = req('signup-rules');
  var SSO_LABEL = null; // connexion par compte licencié : absente de la démo
  var STATUS_LABELS = { awaiting_medical: 'En attente du rapport médical', complete: 'Complet', no_medical: 'Sans rapport médical' };
  var PROCESSING = { a_analyser: 'À analyser', en_cours: 'En cours', clos: 'Clos' };

  // ---------- Stockage local ----------
  // Version de test (« recette ») : écrans identiques à l'application, sans explication ni bandeau de démo,
  // avec des accès directs (codes, liens) et de vrais fichiers (exports CSV, pièces jointes)
  var RECETTE = window.DEMO_FLAVOR === 'recette';
  var KEY = RECETTE ? 'ffsa-test-v1' : 'ffsa-demo-v1';
  var PASSWORD = RECETTE ? 'Test-FFSA-2026!' : 'Demo-FFSA-2026!';
  // Clé TOTP commune de la version de test : les codes sont de vrais codes RFC 6238 (application d'authentification possible)
  var TEST_SECRET = window.DEMO_TOTP_SECRET || 'KRSXG5CTMVRXEZLUKRSXG5CT';
  var state;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* stockage indisponible */ } }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
    return null;
  }
  var rnd = function (n) { var a = new Uint8Array(n || 18); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]; }).join(''); };
  var uuid = function () { return crypto.randomUUID ? crypto.randomUUID() : rnd(8) + '-' + rnd(4) + '-' + rnd(4) + '-' + rnd(4) + '-' + rnd(12); };
  var now = function () { return new Date().toISOString(); };
  var digits = function () { return String(Math.floor(Math.random() * 900000) + 100000); };

  function mail(tpl, to, params) {
    var t = mailTemplates[tpl](params);
    state.mails.push({ to: to, subject: t.subject, text: t.text, date: now() });
  }
  function normPhone(raw) {
    var n = String(raw || '').replace(/[\s.\-()]/g, '');
    if (/^0[1-9]\d{8}$/.test(n)) n = '+33' + n.slice(1);
    return /^\+\d{8,15}$/.test(n) ? n : null;
  }
  function sms(tpl, phone, params) {
    var to = normPhone(phone);
    if (to && smsTemplates[tpl]) state.mails.push({ to: to, subject: 'SMS', text: smsTemplates[tpl](params), date: now(), sms: true });
  }
  var maskPhone = function (raw) { var n = String(raw || '').replace(/\D/g, ''); return n.length >= 4 ? '•• •• •• ' + n.slice(-4, -2) + ' ' + n.slice(-2) : ''; };
  function invite(r, a, tpl) {
    var link = '/medecin/' + r.token;
    mail(tpl || 'doctorInvitation', r.doctorEmail, { reference: a.reference, eventName: a.event_name, link: link, expiresAt: new Date(r.expires_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).replace(' ', ' à ') });
    sms(tpl || 'doctorInvitation', r.doctorPhone, { reference: a.reference, link: link });
  }
  function audit(action, targetType, targetId) {
    var u = currentUser();
    state.audit.unshift({ at: now(), actor: u ? u.email + ' (' + u.role + ')' : (state.session.doctorEmail ? 'médecin ' + state.session.doctorEmail : 'anonyme'), action: action, target_type: targetType || null, target_id: targetId || null, ip: 'démo' });
    if (state.audit.length > 300) state.audit.length = 300;
  }

  // ---------- Données initiales ----------
  function createAccident(organizer, values) {
    var id = uuid();
    state.seq += 1;
    var ref = 'ACC-' + new Date().getFullYear() + '-' + String(state.seq).padStart(5, '0');
    // Rapport médical demandé seulement si le médecin de l'épreuve a examiné les personnes accidentées
    var withMedical = values.doctor_examined !== 'Non';
    var a = { id: id, reference: ref, organizer_id: organizer.id, status: withMedical ? 'awaiting_medical' : 'no_medical', event_name: values.event_name, event_date: values.accident_date || null, discipline: values.discipline || null, data: values, created_at: now(), completed_at: withMedical ? null : now(), processing_status: 'a_analyser' };
    state.accidents.unshift(a);
    var ctx = { reference: ref, eventName: a.event_name, withMedical: withMedical };
    if (withMedical) invite(createRequest(a, values.doctor_email, values.doctor_phone), a);
    mail('organizerConfirmation', organizer.email, ctx);
    mail('serviceNewAccident', 'service.medical@ffsa.fr', { reference: ref, eventName: a.event_name, withMedical: withMedical, link: '/back-office/dossiers/' + id });
    return a;
  }
  function createRequest(a, email, phone, from) {
    state.requests.forEach(function (r) { if (r.accident_id === a.id && !r.revoked_at && !r.used_at) r.revoked_at = now(); });
    var r = { id: uuid(), accident_id: a.id, doctorEmail: email, doctorPhone: phone || null, transferred_from: from || null, token: rnd(24), expires_at: new Date(Date.now() + 48 * 3600e3).toISOString(), sent_at: now(), reminder_sent_at: null, revoked_at: null, used_at: null, otp: null, otp_expires: 0 };
    state.requests.push(r);
    return r;
  }
  function finish(a) {
    state.requests.forEach(function (r) { if (r.accident_id === a.id && !r.used_at) r.used_at = now(); });
    a.status = 'complete'; a.completed_at = now();
    mail('serviceComplete', 'service.medical@ffsa.fr', { reference: a.reference, eventName: a.event_name, link: '/back-office/dossiers/' + a.id });
  }

  // Pièces jointes d'exemple (contenu fourni par window.DEMO_SAMPLES dans la version de test)
  function sampleFiles(a) {
    [['diagram', 'photo-sortie-de-route.jpg', 'image/jpeg', 34628, 'photo'], ['logbook', 'main-courante.pdf', 'application/pdf', 2140, 'pdf']].forEach(function (f) {
      state.attachments.push({ id: uuid(), accident_id: a.id, source: 'accident', field: f[0], filename: f[1], mime_type: f[2], size_bytes: f[3], sample: f[4], created_at: now() });
    });
  }
  var ex = function (label) { return RECETTE ? label.replace(' (exemple)', '') : label; };
  function seed() {
    state = { seq: 0, users: [], accidents: [], requests: [], medical: [], attachments: [], mails: [], audit: [], notes: [], drafts: {}, session: {} };
    (RECETTE
      ? [['directeur.test@ffsa.org', 'Jean Martin', 'organizer', false], ['medical.test@ffsa.org', 'Dr Sophie Bernard', 'medical', true], ['admin.test@ffsa.org', 'Administrateur FFSA', 'admin', true]]
      : [['directeur@demo.ffsa.fr', 'Directeur de course Démo', 'organizer', false], ['medical@demo.ffsa.fr', 'Service médical Démo', 'medical', true], ['admin@demo.ffsa.fr', 'Administrateur Démo', 'admin', true]])
      .forEach(function (u) { state.users.push({ id: uuid(), email: u[0], full_name: u[1], role: u[2], password: PASSWORD, totp_enabled: u[3], active: true, activated: true, auth_source: 'local', approval_status: 'approved', email_verified_at: now(), last_login_at: null, created_at: now(), organization: u[2] === 'organizer' ? (RECETTE ? 'ASA des Vosges' : 'ASA Démo (exemple)') : null }); });
    var orga = state.users[0];
    var base = { doctor_examined: 'Oui', doctor_first_name: 'Claire', doctor_last_name: 'Moreau', doctor_email: 'dr.moreau@demo.ffsa.fr', doctor_phone: '06 12 34 56 78', author_first_name: 'Jean', author_last_name: 'Martin', author_role: 'Directeur de course', author_license: '178842',
    monday_contact_last_name: 'Martin', monday_contact_first_name: 'Jean', monday_contact_email: 'jean.martin@asa-demo.fr', monday_contact_phone: '06 21 43 65 87' };
    var a1 = createAccident(orga, Object.assign({}, base, {
      event_name: ex('Rallye des Vosges (exemple)'), event_location: 'Gérardmer', discipline: 'Rallye', event_level: 'Épreuve nationale',
      accident_date: '2026-09-20', accident_time: '14:35',
      circumstances: 'Sortie de route en ES3, tonneau. Pilote extrait par l’équipe d’intervention.',
      casualties: { Pilotes: { 'Nombre de blessés': 1 } }, vehicle1_driver_last_name: 'Exemple', vehicle1_driver_first_name: 'Paul', vehicle1_number: '27', vehicle1_license: '254781', vehicle1_vehicle_type: 'Voiture de tourisme (y compris SUV et 4x4)',
      weather: 'Nuageux', surface: 'Asphalte', track_condition: 'Mouillé',
    }));
    sampleFiles(a1);
    var a2 = createAccident(orga, Object.assign({}, base, {
      event_name: ex('Course de côte du Mont-Dore (exemple)'), event_location: 'Le Mont-Dore', discipline: 'Course de côte',
      accident_date: '2026-09-27', accident_time: '10:05', vehicle1_driver_last_name: 'Exemple', vehicle1_driver_first_name: 'Léa', vehicle1_number: '112', vehicle1_license: '287654',
      circumstances: 'Choc latéral contre le rail au virage 7.',
    }));
    sampleFiles(a2);
    state.medical.push({ id: uuid(), accident_id: a1.id, patient_ref: 'vehicle1', created_at: now(), data: {
      date: '2026-09-20', time: '14:35', place: 'Gérardmer', event: ex('Rallye des Vosges (exemple)'),
      patient_last_name: 'Exemple', patient_first_name: 'Paul', patient_type: ['Pilote'], bp: '130/80', pulse: '92', glasgow: '15',
      upper_limbs: { Clavicule: { Droite: 'Fracture' } }, spine: ['Cervical'], decision: ['Évacuation non urgente', 'Imagerie'],
      hospital: 'CHU de Nancy', diagnosis: 'Fracture de la clavicule droite suspectée.', classification: "2 : transfert à l'hôpital",
      fit: 'Oui (pas de suspension de licence)', current_event: 'Inapte à reprendre', doctor_name: 'Claire Moreau' } });
    finish(a1);
    // Démo : le second dossier date de 3 jours et son lien a expiré (« en retard » dans le back office).
    // Version de test : son lien reste valable, pour accéder tout de suite au formulaire médical.
    if (!RECETTE) {
      state.accidents.forEach(function (a) { if (a.status === 'awaiting_medical') a.created_at = new Date(Date.now() - 3 * 864e5).toISOString(); });
      state.requests.forEach(function (r) { if (r.accident_id === a2.id) r.expires_at = new Date(Date.now() - 864e5).toISOString(); });
    }
    state.mails = [];
    state.audit = [];
    save();
  }

  // ---------- Helpers « serveur » ----------
  var ROLE_LABELS = { organizer: 'Directeur de course', medical: 'Service médical (accès aux données de santé)', admin: 'Administrateur (comptes et journal, sans données de santé)' };
  function currentUser() { var id = state.session.userId; return id ? state.users.find(function (u) { return u.id === id && u.active; }) || null : null; }
  var homeFor = function (u) { return !u ? '/connexion' : u.role === 'organizer' ? '/organisateur' : u.role === 'admin' ? '/back-office/utilisateurs' : '/back-office'; };
  var maskMail = function (e) { return e.replace(/^(.)(.*)(@.*)$/, function (m, a, b, c) { return a + '•'.repeat(Math.min(b.length, 6)) + c; }); };
  // Second facteur : application (comptes du back office) ou code par e-mail (organisateurs)
  function beginMfa(user) {
    state.session = { mfaUserId: user.id, mfaMethod: user.totp_enabled ? 'totp' : 'email' };
    if (!user.totp_enabled) {
      state.session.mfaCode = digits(); state.session.mfaExp = Date.now() + 10 * 60000; state.session.mfaAttempts = 0;
      mail('loginCode', user.email, { code: state.session.mfaCode, minutes: 10 });
    }
    return redirect('/connexion/2fa');
  }
  function mfaView(error, status, resent) {
    var mu = state.users.find(function (x) { return x.id === state.session.mfaUserId; });
    var email = state.session.mfaMethod === 'email';
    return view('auth/totp', { title: 'Double authentification', error: error || null, resent: Boolean(resent), method: state.session.mfaMethod,
      maskedEmail: email ? maskMail(mu.email) : null, demoCode: email ? state.session.mfaCode : demoCode() }, status);
  }
  // Code de double authentification : simulé dans la démo (change chaque minute) ; vrai code TOTP dans la version de test
  var demoCode = function (offset) {
    if (RECETTE) return totp(TEST_SECRET, offset || 0);
    var t = Math.floor(Date.now() / 60000) - (offset || 0); return String((t * 104729) % 900000 + 100000);
  };
  // TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 chiffres), calcul synchrone
  function sha1(bytes) {
    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    var ml = bytes.length, withPad = ((ml + 9 + 63) >> 6) << 6, m = new Uint8Array(withPad);
    m.set(bytes); m[ml] = 0x80;
    var bits = ml * 8; for (var i = 0; i < 4; i++) m[withPad - 1 - i] = (bits >>> (8 * i)) & 0xff;
    var w = new Int32Array(80);
    for (var off = 0; off < withPad; off += 64) {
      for (var j = 0; j < 16; j++) w[j] = (m[off + 4 * j] << 24) | (m[off + 4 * j + 1] << 16) | (m[off + 4 * j + 2] << 8) | m[off + 4 * j + 3];
      for (j = 16; j < 80; j++) { var x = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]; w[j] = (x << 1) | (x >>> 31); }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (j = 0; j < 80; j++) {
        var f, k;
        if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; } else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    var out = new Uint8Array(20);
    [h0, h1, h2, h3, h4].forEach(function (h, i) { for (var q = 0; q < 4; q++) out[4 * i + q] = (h >>> (24 - 8 * q)) & 0xff; });
    return out;
  }
  function hmacSha1(key, msg) {
    if (key.length > 64) key = sha1(key);
    var k = new Uint8Array(64); k.set(key);
    var ipad = new Uint8Array(64 + msg.length), opad = new Uint8Array(84);
    for (var i = 0; i < 64; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    ipad.set(msg, 64); opad.set(sha1(ipad), 64);
    return sha1(opad);
  }
  function base32(str) {
    var alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits = 0, value = 0, out = [];
    String(str).replace(/=+$/, '').toUpperCase().split('').forEach(function (ch) {
      value = (value << 5) | alpha.indexOf(ch); bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
    });
    return new Uint8Array(out);
  }
  function totp(secret, stepsBack) {
    var counter = Math.floor(Date.now() / 30000) - (stepsBack || 0);
    var msg = new Uint8Array(8);
    for (var i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter = Math.floor(counter / 256); }
    var h = hmacSha1(base32(secret), msg), o = h[19] & 0xf;
    var bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(bin % 1000000).padStart(6, '0');
  }
  var view = function (name, locals, status) { return { view: name, locals: locals || {}, status: status || 200 }; };
  var redirect = function (to) { return { redirect: to }; };
  var info = function (title, message, link, linkLabel) { return view('errors/info', { title: title, message: message, link: link || null, linkLabel: linkLabel || '' }); };
  var notFound = function () { return view('errors/error', { title: 'Page introuvable', message: "Cette page n'existe pas." }, 404); };
  var denied = function () { return view('errors/error', { title: 'Accès refusé', message: "Vous n'avez pas accès à cette page." }, 403); };
  var maskEmail = function (e) { return e.replace(/^(.)(.*)(@.*)$/, function (m, a, b, c) { return a + '•'.repeat(Math.min(b.length, 6)) + c; }); };
  var accidentById = function (id) { return state.accidents.find(function (a) { return a.id === id; }); };
  var patientName = function (d) { return [d.patient_last_name, d.patient_first_name].filter(Boolean).join(' '); };

  function requireRole(roles) {
    var u = currentUser();
    if (!u) { state.session.returnTo = null; return redirect('/connexion'); }
    if (roles.indexOf(u.role) === -1) return denied();
    return null;
  }

  function loadRequest(token) {
    var r = state.requests.find(function (x) { return x.token === token; });
    if (!r) return { stop: view('errors/error', { title: 'Lien invalide', message: "Ce lien n'est pas valide." }, 404) };
    var a = accidentById(r.accident_id);
    var msg = null;
    if (r.used_at || a.status === 'complete') msg = 'Le dossier médical de cet accident a été clôturé et transmis au service médical de la FFSA. Merci.';
    else if (r.revoked_at) msg = 'Ce lien a été remplacé par un lien plus récent. Utilisez le dernier e-mail reçu.';
    else if (new Date(r.expires_at) < new Date()) msg = 'Ce lien a expiré : le rapport médical doit être rempli dans les 48 heures. Contactez le service médical de la FFSA, qui peut vous envoyer un nouveau lien.';
    if (msg) return { stop: view('errors/info', { title: 'Rapport médical', message: msg }, 410) };
    var acc = state.session.doctorAccess;
    return { r: r, a: a, verified: Boolean(acc && acc.requestId === r.id && acc.until > Date.now()) };
  }

  function verifyLocals(ctx, codeSent, error) {
    return { title: 'Vérification', reference: ctx.a.reference, maskedEmail: maskEmail(ctx.r.doctorEmail), maskedPhone: ctx.r.doctorPhone ? maskPhone(ctx.r.doctorPhone) : null, codeSent: codeSent, error: error || null, token: ctx.r.token, testCode: RECETTE && codeSent ? ctx.r.otp : null };
  }

  // En retard : rapport médical attendu mais plus aucun lien valable (lien du médecin valable 48 h)
  var isOverdue = function (a) { return a.status === 'awaiting_medical' && !state.requests.some(function (r) { return r.accident_id === a.id && !r.revoked_at && !r.used_at && new Date(r.expires_at) > new Date(); }); };
  var draftLocals = function (url, discard, key) { var d = state.drafts[key]; return { draftUrl: url, discardUrl: discard, draftSavedAt: d ? d.updatedAt : null }; };
  function filtered(q) {
    return state.accidents.filter(function (a) {
      if (q.statut && a.status !== q.statut) return false;
      if (q.discipline && a.discipline !== q.discipline) return false;
      if (q.du && (!a.event_date || a.event_date < q.du)) return false;
      if (q.au && (!a.event_date || a.event_date > q.au)) return false;
      if (q.q) { var s = q.q.toLowerCase(); if (a.reference.toLowerCase().indexOf(s) === -1 && a.event_name.toLowerCase().indexOf(s) === -1) return false; }
      if (q.suivi && a.processing_status !== q.suivi) return false;
      if (q.retard === '1' && !isOverdue(a)) return false;
      return true;
    });
  }

  // ---------- Routes ----------
  function handle(method, path, query, body, files) {
    var m, u = currentUser(), ctx, err;
    if (path === '/' ) return redirect(homeFor(u));

    // Authentification
    if (path === '/connexion' && method === 'GET') {
      if (u) return redirect(homeFor(u));
      return view('auth/login', { title: 'Connexion', error: null, email: '', demoAccounts: demoAccounts(), testDoctors: testDoctors(), ssoLabel: SSO_LABEL });
    }
    if (path === '/connexion' && method === 'POST') {
      var email = String(body.email || '').trim().toLowerCase();
      var found = state.users.find(function (x) { return x.email === email && x.active; });
      var loginErr = function (msg) { return view('auth/login', { title: 'Connexion', error: msg, email: email, demoAccounts: demoAccounts(), testDoctors: testDoctors(), ssoLabel: SSO_LABEL }, 401); };
      if (!found || !found.password || found.password !== body.password) return loginErr('Identifiants incorrects.');
      if (found.approval_status === 'rejected') return loginErr("Votre demande de compte n'a pas été acceptée. Contactez le service médical de la FFSA.");
      if (found.approval_status === 'pending' && !found.email_verified_at) {
        found.verifyToken = rnd(24);
        mail('signupVerify', found.email, { name: found.full_name, link: '/inscription/confirmer/' + found.verifyToken });
        return loginErr('Confirmez d’abord votre adresse e-mail : un nouveau lien de confirmation vient de vous être envoyé.');
      }
      return beginMfa(found);
    }
    if (path === '/connexion/2fa') {
      if (!state.session.mfaUserId) return redirect('/connexion');
      if (method === 'POST') {
        var typed = String(body.code || '').replace(/\s/g, '');
        var okCode;
        if (state.session.mfaMethod === 'email') {
          state.session.mfaAttempts += 1;
          okCode = state.session.mfaAttempts <= 5 && Date.now() < state.session.mfaExp && typed === state.session.mfaCode;
        } else okCode = typed === demoCode() || typed === demoCode(1);
        if (!okCode) return mfaView(state.session.mfaMethod === 'email' && state.session.mfaAttempts >= 5 ? 'Trop d’essais : demandez un nouveau code.' : 'Code incorrect ou expiré.', 401);
        var mu = state.users.find(function (x) { return x.id === state.session.mfaUserId; });
        return login(mu);
      }
      return mfaView(null, 200, query.renvoye);
    }
    if (path === '/connexion/2fa/renvoyer' && method === 'POST') {
      var ru2 = state.users.find(function (x) { return x.id === state.session.mfaUserId; });
      if (!ru2 || state.session.mfaMethod !== 'email') return redirect('/connexion');
      beginMfa(ru2);
      return redirect('/connexion/2fa?renvoye=1');
    }
    if (path === '/donnees-personnelles') return view('legal/privacy', { title: 'Données personnelles', retentionYears: 10,
      privacy: { controller: 'Fédération Française du Sport Automobile (FFSA) [adresse du siège à compléter]', dpoContact: '[adresse de contact du délégué à la protection des données à compléter]', legalBasis: '', validated: false } });
    // Inscription libre
    if (path === '/inscription') {
      var signupLocals = function (extra) { return Object.assign({ title: 'Créer un compte directeur de course', values: {}, errors: {}, formError: null, ssoLabel: SSO_LABEL }, extra); };
      if (method === 'GET') return u ? redirect(homeFor(u)) : view('auth/signup', signupLocals());
      if (body.website) return view('auth/signup-done', { title: 'Vérifiez votre boîte mail' });
      var sv = signupRules.validateSignup(body);
      var pw = body.password || '';
      var pclasses = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (re) { return re.test(pw); }).length;
      var perr = pw !== body.confirm ? 'Les mots de passe ne correspondent pas.' : pw.length < 12 ? 'Le mot de passe doit contenir au moins 12 caractères.' : pclasses < 3 ? 'Le mot de passe doit mélanger au moins 3 types : minuscules, majuscules, chiffres, caractères spéciaux.' : null;
      if (perr) sv.errors.password = perr;
      if (Object.keys(sv.errors).length) return view('auth/signup', signupLocals({ values: sv.v, errors: sv.errors, formError: 'Le formulaire contient des erreurs, vérifiez les champs signalés.' }), 400);
      if (state.users.some(function (x) { return x.email === sv.v.email; })) {
        mail('signupExisting', sv.v.email, { link: '/mot-de-passe-oublie' });
      } else {
        var nu2 = { id: uuid(), email: sv.v.email, full_name: sv.v.first_name + ' ' + sv.v.last_name, role: 'organizer', password: pw, totp_enabled: false, active: true, activated: true,
          auth_source: 'local', approval_status: 'pending', email_verified_at: null, phone: sv.v.phone,
          license_number: sv.v.license_number || null, created_at: now(), verifyToken: rnd(24) };
        state.users.push(nu2);
        mail('signupVerify', nu2.email, { name: nu2.full_name, link: '/inscription/confirmer/' + nu2.verifyToken });
      }
      var created = state.users.find(function (x) { return x.email === sv.v.email && x.verifyToken; });
      return view('auth/signup-done', { title: 'Vérifiez votre boîte mail', email: sv.v.email, testLink: created ? '/inscription/confirmer/' + created.verifyToken : null });
    }
    if ((m = path.match(/^\/inscription\/confirmer\/(\w+)$/))) {
      var vu = state.users.find(function (x) { return x.verifyToken && x.verifyToken === m[1]; });
      if (!vu) return view('errors/error', { title: 'Lien invalide', message: 'Ce lien de confirmation est invalide ou a expiré. Connectez-vous pour en recevoir un nouveau.' }, 410);
      vu.email_verified_at = now(); vu.approval_status = 'approved'; delete vu.verifyToken;
      return info('Compte activé', 'Merci, votre adresse est confirmée et votre compte est actif. Vous pouvez vous connecter.', '/connexion', 'Se connecter');
    }
    if (path === '/deconnexion' && method === 'POST') { audit('logout'); state.session = {}; return redirect('/connexion'); }
    if (path === '/mot-de-passe-oublie') {
      var fu = method === 'POST' ? state.users.find(function (x) { return x.email === String(body.email || '').trim().toLowerCase() && x.active; }) : null;
      if (fu) { fu.inviteToken = rnd(24); mail('passwordReset', fu.email, { link: '/mot-de-passe/' + fu.inviteToken }); }
      return view('auth/forgot', { title: 'Mot de passe oublié', sent: method === 'POST', testLink: fu ? '/mot-de-passe/' + fu.inviteToken : null });
    }
    if ((m = path.match(/^\/mot-de-passe\/(\w+)$/))) {
      var invited = state.users.find(function (x) { return x.inviteToken === m[1]; });
      if (!invited) return view('errors/error', { title: 'Lien invalide', message: 'Ce lien est invalide ou a expiré.' }, 410);
      if (method === 'POST') {
        var p = body.password || '';
        var classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (re) { return re.test(p); }).length;
        err = p !== body.confirm ? 'Les mots de passe ne correspondent pas.' : p.length < 12 ? 'Le mot de passe doit contenir au moins 12 caractères.' : classes < 3 ? 'Le mot de passe doit mélanger au moins 3 types : minuscules, majuscules, chiffres, caractères spéciaux.' : null;
        if (err) return view('auth/set-password', { title: 'Définir le mot de passe', error: err, email: invited.email }, 400);
        invited.password = p; invited.activated = true; delete invited.inviteToken;
        return info('Mot de passe enregistré', 'Vous pouvez maintenant vous connecter.', '/connexion', 'Se connecter');
      }
      return view('auth/set-password', { title: 'Définir le mot de passe', error: null, email: invited.email });
    }
    if (path === '/compte/2fa') {
      if (!u) return redirect('/connexion');
      if (u.totp_enabled) return view('account/totp-enabled', { title: 'Double authentification' });
      if (!RECETTE) return info('Double authentification', "Dans l'application, l'utilisateur scanne ici un QR code avec son téléphone. Cette étape n'est pas simulée dans la démo en ligne.");
      var setup = function (error, status) { return view('account/totp-setup', { title: 'Activer la double authentification', qr: window.DEMO_QR || '', secret: TEST_SECRET, error: error, testCode: demoCode() }, status); };
      if (method === 'POST') {
        var c2 = String(body.code || '').replace(/\s/g, '');
        if (c2 !== demoCode() && c2 !== demoCode(1)) return setup('Code incorrect. Réessayez avec le code affiché par l’application.', 400);
        u.totp_enabled = true; audit('totp_enabled', 'user', u.id);
        return redirect(homeFor(u));
      }
      return setup(null);
    }

    // Organisateur
    if (path.indexOf('/organisateur') === 0) {
      var stop = requireRole(['organizer']); if (stop) return stop;
      if (path === '/organisateur') {
        var mine = state.accidents.filter(function (a) { return a.organizer_id === u.id; });
        return view('organizer/index', { title: 'Mes déclarations', reports: mine, draft: engine.draftSummary(accidentForm, state.drafts['accident:' + u.id]), created: query.cree || null });
      }
      var okey = 'accident:' + u.id;
      if (path === '/organisateur/brouillon/supprimer' && method === 'POST') { delete state.drafts[okey]; return redirect(body.retour === 'liste' ? '/organisateur' : '/organisateur/rapports/nouveau'); }
      if (path === '/organisateur/rapports/nouveau') {
        var od = state.drafts[okey];
        return view('organizer/new', Object.assign({ title: accidentForm.title, form: accidentForm, values: od ? od.values : { asa: u.organization || '' }, errors: {}, formError: null }, draftLocals('/organisateur/brouillon', '/organisateur/brouillon/supprimer', okey)));
      }
      if (path === '/organisateur/rapports' && method === 'POST') {
        var v = engine.validate(accidentForm, body, files);
        if (Object.keys(v.errors).length) return view('organizer/new', Object.assign({ title: accidentForm.title, form: accidentForm, values: v.raw, errors: v.errors, formError: 'Le formulaire contient des erreurs, vérifiez les champs signalés.' }, draftLocals('/organisateur/brouillon', '/organisateur/brouillon/supprimer', '')), 400);
        var a = createAccident(u, v.values);
        delete state.drafts[okey];
        addFiles(a.id, 'accident', files);
        audit('accident_created', 'accident', a.id);
        return redirect('/organisateur?cree=' + encodeURIComponent(a.reference));
      }
      if ((m = path.match(/^\/organisateur\/rapports\/([\w-]+)$/))) {
        var own = accidentById(m[1]);
        if (!own || own.organizer_id !== u.id) return notFound();
        return view('organizer/show', { title: 'Dossier ' + own.reference, accident: own, sections: engine.toDisplay(accidentForm, own.data) });
      }
      return notFound();
    }

    // Médecin
    if ((m = path.match(/^\/medecin\/(\w+)(\/[a-z]+)?(?:\/supprimer)?$/))) {
      ctx = loadRequest(m[1]); if (ctx.stop) return ctx.stop;
      var sub = m[2] || '';
      var token = ctx.r.token;
      if (sub === '/code' && method === 'POST') {
        ctx.r.otp = digits(); ctx.r.otp_expires = Date.now() + 10 * 60000;
        mail('doctorOtp', ctx.r.doctorEmail, { reference: ctx.a.reference, code: ctx.r.otp });
        sms('doctorOtp', ctx.r.doctorPhone, { reference: ctx.a.reference, code: ctx.r.otp });
        return view('doctor/verify', verifyLocals(ctx, true));
      }
      if (sub === '/verifier' && method === 'POST') {
        if (!ctx.r.otp || ctx.r.otp_expires < Date.now() || String(body.code || '').trim() !== ctx.r.otp) return view('doctor/verify', verifyLocals(ctx, true, 'Code incorrect ou expiré.'), 401);
        ctx.r.otp = null;
        state.session.doctorAccess = { requestId: ctx.r.id, until: Date.now() + 3600e3 };
        state.session.doctorEmail = ctx.r.doctorEmail;
        audit('doctor_access_granted', 'accident', ctx.a.id);
        return redirect('/medecin/' + token);
      }
      if (!ctx.verified) return sub ? redirect('/medecin/' + token) : view('doctor/verify', verifyLocals(ctx, Boolean(ctx.r.otp && ctx.r.otp_expires > Date.now())));
      var persons = declaredPersons(ctx.a.data);
      var ref = query.p && persons.some(function (x) { return x.key === query.p; }) ? query.p : 'autre';
      var person = persons.find(function (x) { return x.key === ref; }) || null;
      var dkey = 'medical:' + ctx.a.id + ':' + ref;
      var formLocals = function (values, errors, formError) {
        return Object.assign({ title: medicalForm.title + ' – ' + ctx.a.reference, form: medicalForm, accident: ctx.a, person: person, values: values, errors: errors || {}, formError: formError || null, token: token,
          action: '/medecin/' + token + '/patient?p=' + ref }, draftLocals('/medecin/' + token + '/brouillon?p=' + ref, '/medecin/' + token + '/brouillon/supprimer?p=' + ref, dkey));
      };
      if (sub === '/brouillon') { delete state.drafts[dkey]; return redirect('/medecin/' + token + '/patient?p=' + ref); }
      if (sub === '/patient') {
        if (method === 'POST') {
          var mv = engine.validate(medicalForm, body, files);
          if (Object.keys(mv.errors).length) return view('doctor/form', formLocals(mv.raw, mv.errors, 'Le formulaire contient des erreurs, vérifiez les champs signalés.'), 400);
          var rep = { id: uuid(), accident_id: ctx.a.id, patient_ref: ref === 'autre' ? null : ref, data: mv.values, created_at: now() };
          state.medical.push(rep);
          delete state.drafts[dkey];
          audit('medical_submitted', 'medical_report', rep.id);
          return redirect('/medecin/' + token + '?ajoute=1');
        }
        var dd = state.drafts[dkey];
        return view('doctor/form', formLocals(dd ? dd.values : Object.assign({}, engine.prefill(medicalForm, ctx.a.data), person ? person.prefill : {})));
      }
      if (sub === '/cloturer' && method === 'POST') {
        if (!state.medical.some(function (x) { return x.accident_id === ctx.a.id; })) return redirect('/medecin/' + token + '?vide=1');
        finish(ctx.a);
        audit('medical_closed', 'accident', ctx.a.id);
        delete state.session.doctorAccess;
        return info('Rapport médical transmis', 'Merci, le rapport médical du dossier ' + ctx.a.reference + ' a été transmis au service médical de la FFSA.');
      }
      var pats = state.medical.filter(function (x) { return x.accident_id === ctx.a.id; });
      var plist = persons.map(function (p) { return Object.assign({}, p, { report: pats.find(function (x) { return x.patient_ref === p.key; }) || null }); });
      return view('doctor/dossier', {
        title: 'Rapport médical – ' + ctx.a.reference, accident: ctx.a, token: token,
        context: engine.toDisplay(accidentForm, ctx.a.data).filter(function (s) { return s.shareWithDoctor; }),
        persons: plist,
        others: pats.filter(function (x) { return !x.patient_ref || !persons.some(function (p) { return p.key === x.patient_ref; }); })
          .map(function (x) { return { name: patientName(x.data), classification: x.data.classification, at: x.created_at }; }),
        reportCount: pats.length,
        flash: query.ajoute ? 'Rapport enregistré.' : null,
        error: query.vide ? 'Ajoutez au moins un rapport patient avant de clôturer.' : null,
      });
    }

    // Back office
    if (path.indexOf('/back-office') === 0) {
      var st = requireRole(['medical', 'admin']); if (st) return st;
      // Données de santé : service médical uniquement ; l'administrateur gère les comptes et le journal
      if (u.role === 'admin' && (path === '/back-office' || path.indexOf('/back-office/dossiers') === 0 || path.indexOf('/back-office/export') === 0)) {
        return path === '/back-office' ? redirect('/back-office/utilisateurs') : denied();
      }
      if (path === '/back-office/export-pseudonymise.csv') {
        if (RECETTE) { downloadCsv('pseudo', filtered(query)); audit('export_pseudonymized'); return { stay: true }; }
        return info('Export statistique pseudonymisé', "Dans l'application, ce bouton télécharge un tableur pour les statistiques : sans nom, coordonnées, texte libre ni signature, dates réduites au mois, âge calculé et identifiant de dossier non réversible. Le téléchargement de fichiers n'est pas possible dans cette démo en ligne.", '/back-office', 'Retour aux dossiers');
      }
      if (path === '/back-office') {
        var list = filtered(query);
        var page = Math.max(1, Number(query.page) || 1);
        var rowsAll = list.map(function (a) {
          var o = state.users.find(function (x) { return x.id === a.organizer_id; });
          return Object.assign({}, a, { organizer_name: o ? o.full_name : '', overdue: isOverdue(a) });
        });
        // Tri : colonne choisie (?tri=…&ordre=asc|desc), sinon dossiers en retard puis plus récents
        var SORT_KEYS = { reference: 'reference', epreuve: 'event_name', discipline: 'discipline', date: 'event_date', directeur: 'organizer_name', statut: 'status', suivi: 'processing_status', depose: 'created_at' };
        var sort = SORT_KEYS[query.tri] ? { key: query.tri, dir: query.ordre === 'desc' ? 'desc' : 'asc' } : null;
        rowsAll.sort(function (x, y) {
          if (!sort) return (y.overdue - x.overdue) || (y.created_at > x.created_at ? 1 : -1);
          var k = SORT_KEYS[sort.key], vx = x[k] || '', vy = y[k] || '';
          var c = String(vx).localeCompare(String(vy), 'fr');
          return (sort.dir === 'desc' ? -c : c) || (y.created_at > x.created_at ? 1 : -1);
        });
        var rows = rowsAll.slice((page - 1) * 50, page * 50);
        var all = state.accidents;
        var stats = { total: all.length, overdue: all.filter(isOverdue).length, pending: all.filter(function (a) { return a.status === 'awaiting_medical'; }).length,
          to_review: all.filter(function (a) { return a.status !== 'awaiting_medical' && a.processing_status === 'a_analyser'; }).length,
          no_medical: all.filter(function (a) { return a.status === 'no_medical'; }).length };
        var eq = new URLSearchParams(Object.entries(query).filter(function (e) { return e[0] !== 'page' && e[1]; })).toString();
        return view('backoffice/index', { title: 'Dossiers', reports: rows, stats: stats, query: query, sort: sort, statusLabels: STATUS_LABELS, page: page, pages: Math.max(1, Math.ceil(list.length / 50)), total: list.length,
          disciplines: engine.allFields(accidentForm).find(function (f) { return f.name === 'discipline'; }).options, processing: PROCESSING, exportQuery: eq });
      }
      if (path === '/back-office/export.csv' && RECETTE) { downloadCsv('complet', filtered(query)); audit('export_csv'); return { stay: true }; }
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/pdf\/\w+$/)) && RECETTE) { audit('pdf_downloaded', 'accident', m[1]); setTimeout(function () { window.print(); }, 50); return { stay: true }; }
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/pieces\/([\w-]+)$/)) && RECETTE) { downloadAttachment(m[2]); audit('attachment_downloaded', 'attachment', m[2]); return { stay: true }; }
      if (path === '/back-office/export.csv') return info('Export tableur', "L'export CSV (une ligne par patient, ouvrable dans Excel) fonctionne dans l'application. Le téléchargement de fichiers n'est pas possible dans cette démo en ligne.", '/back-office', 'Retour aux dossiers');
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/pdf\/\w+$/))) return info('Téléchargement PDF', "Dans l'application, ce bouton télécharge le dossier en PDF au format du rapport FFSA (en-tête et pied de page FFSA, rubriques du formulaire, certifications). Le téléchargement de fichiers n'est pas possible dans cette démo en ligne.", '/back-office/dossiers/' + m[1], 'Retour au dossier');
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/pieces\/[\w-]+$/))) return info('Pièce jointe', "Le téléchargement des pièces jointes fonctionne dans l'application. Les fichiers ne sont pas conservés dans cette démo en ligne.", '/back-office/dossiers/' + m[1], 'Retour au dossier');
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/relance$/)) && method === 'POST') {
        var ra = accidentById(m[1]); if (!ra) return notFound();
        var lastReq = state.requests.filter(function (x) { return x.accident_id === ra.id; }).pop();
        var re = createRequest(ra, String(body.doctor_email || '').trim(), String(body.doctor_phone || '').trim() || (lastReq && lastReq.doctorPhone));
        invite(re, ra);
        audit('doctor_invitation_resent', 'accident', ra.id);
        return redirect('/back-office/dossiers/' + ra.id + '?relance=1');
      }
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/suivi$/)) && method === 'POST') {
        var sa = accidentById(m[1]); if (!sa) return notFound();
        if (PROCESSING[body.processing_status]) sa.processing_status = body.processing_status;
        audit('case_updated', 'accident', sa.id);
        return redirect('/back-office/dossiers/' + sa.id + '?suivi=1');
      }
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/notes$/)) && method === 'POST') {
        var note = String(body.note || '').trim();
        if (note) { state.notes.push({ id: uuid(), accident_id: m[1], author: u.full_name, body: note.slice(0, 5000), created_at: now() }); audit('note_added', 'accident', m[1]); }
        return redirect('/back-office/dossiers/' + m[1] + '?note=1');
      }
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)$/))) {
        var acc = accidentById(m[1]); if (!acc) return notFound();
        audit('dossier_viewed', 'accident', acc.id);
        var orgUser = state.users.find(function (x) { return x.id === acc.organizer_id; }) || {};
        return view('backoffice/show', {
          title: 'Dossier ' + acc.reference, accident: acc, organizer: { full_name: orgUser.full_name, email: orgUser.email },
          accidentSections: engine.toDisplay(accidentForm, acc.data),
          medicalReports: state.medical.filter(function (x) { return x.accident_id === acc.id; }).map(function (x) { return Object.assign({}, x, { sections: engine.toDisplay(medicalForm, x.data) }); }),
          attachments: state.attachments.filter(function (x) { return x.accident_id === acc.id; }),
          requests: state.requests.filter(function (x) { return x.accident_id === acc.id; }).slice().reverse(),
          notes: state.notes.filter(function (x) { return x.accident_id === acc.id; }),
          statusLabels: STATUS_LABELS,
          retentionEnd: (function () { var d = new Date(acc.created_at); d.setFullYear(d.getFullYear() + 10); return d; })(), retentionYears: 10,
          processing: PROCESSING, overdue: isOverdue(acc),
          flash: query.relance ? 'Nouvelle invitation envoyée au médecin.' : query.suivi ? 'Suivi mis à jour.' : query.note ? 'Note ajoutée.' : null,
        });
      }
      var ad = requireRole(['admin']); if (ad) return ad;
      if (path === '/back-office/utilisateurs' && method === 'GET') return usersView(query.ok || null, null);
      if (path === '/back-office/utilisateurs' && method === 'POST') {
        var ne = String(body.email || '').trim().toLowerCase();
        var nn = String(body.full_name || '').trim();
        err = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ne) ? 'Adresse e-mail invalide.' : !nn ? 'Le nom est obligatoire.' : !ROLE_LABELS[body.role] ? 'Rôle invalide.' : state.users.some(function (x) { return x.email === ne; }) ? 'Un compte existe déjà avec cette adresse.' : null;
        if (err) return usersView(null, err, 400);
        var nu = { id: uuid(), email: ne, full_name: nn, role: body.role, password: null, totp_enabled: false, active: true, activated: false, last_login_at: null, created_at: now(), inviteToken: rnd(24) };
        state.users.push(nu);
        mail('userInvitation', ne, { name: nn, role: ROLE_LABELS[nu.role], link: '/mot-de-passe/' + nu.inviteToken });
        audit('user_created', 'user', nu.id);
        state.session.testLink = '/mot-de-passe/' + nu.inviteToken;
        return redirect('/back-office/utilisateurs?ok=' + encodeURIComponent('Invitation envoyée à ' + ne));
      }
      if ((m = path.match(/^\/back-office\/utilisateurs\/([\w-]+)\/([a-z0-9-]+)$/)) && method === 'POST') {
        var tu = state.users.find(function (x) { return x.id === m[1]; }); if (!tu) return notFound();
        var msg;
        if (tu.id === u.id && m[2] !== 'inviter') msg = 'Action impossible sur votre propre compte.';
        else if (m[2] === 'activer') { tu.active = !tu.active; msg = tu.active ? 'Compte de ' + tu.email + ' réactivé.' : 'Compte de ' + tu.email + ' désactivé.'; }
        else if (m[2] === 'reinit-2fa') { tu.totp_enabled = false; msg = 'Double authentification réinitialisée pour ' + tu.email + '.'; }
        else if (m[2] === 'inviter') { tu.inviteToken = rnd(24); mail('userInvitation', tu.email, { name: tu.full_name, role: ROLE_LABELS[tu.role], link: '/mot-de-passe/' + tu.inviteToken }); msg = 'Lien de (ré)initialisation envoyé à ' + tu.email + '.'; }
        audit('user_' + m[2], 'user', tu.id);
        return redirect('/back-office/utilisateurs?ok=' + encodeURIComponent(msg));
      }
      if (path === '/back-office/audit') return view('backoffice/audit', { title: "Journal d'audit", entries: state.audit.slice(0, 100), page: 1 });
      return notFound();
    }

    if (path === '/demo/emails') {
      return view('demo/emails', { title: 'E-mails de démonstration', mails: state.mails.slice().reverse().map(function (x) { return Object.assign({}, x, { to: [].concat(x.to).join(', ') }); }) });
    }
    return notFound();
  }

  function login(user) {
    state.session = { userId: user.id };
    user.last_login_at = now();
    audit('login');
    return redirect(homeFor(user));
  }
  function demoAccounts() {
    return (RECETTE
      ? [['directeur.test@ffsa.org', 'Directeur de course'], ['medical.test@ffsa.org', 'Service médical'], ['admin.test@ffsa.org', 'Administrateur']]
      : [['directeur@demo.ffsa.fr', 'Directeur de course'], ['medical@demo.ffsa.fr', 'Service médical'], ['admin@demo.ffsa.fr', 'Administrateur (sans accès aux données de santé)']])
      .map(function (a) { return { email: a[0], label: a[1], password: PASSWORD }; });
  }
  // Version de test : accès direct au formulaire médical de chaque dossier dont le lien est encore valable
  function testDoctors() {
    if (!RECETTE) return [];
    return state.requests.filter(function (r) { return !r.revoked_at && !r.used_at && new Date(r.expires_at) > new Date(); }).map(function (r) {
      var a = accidentById(r.accident_id);
      return a && a.status === 'awaiting_medical' ? { reference: a.reference, eventName: a.event_name, href: '/medecin/' + r.token } : null;
    }).filter(Boolean).reverse();
  }
  function usersView(flash, error, status) {
    var testLink = state.session.testLink || null;
    delete state.session.testLink;
    return view('backoffice/users', { title: 'Utilisateurs', roleLabels: ROLE_LABELS, flash: flash, error: error, testLink: testLink,
      users: state.users.slice().sort(function (a, b) { return a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name); }) }, status);
  }
  function addFiles(accidentId, source, files) {
    Object.keys(files).forEach(function (field) {
      files[field].forEach(function (f) {
        var att = { id: uuid(), accident_id: accidentId, source: source, field: field, filename: f.originalname, mime_type: f.mimetype, size_bytes: f.size, created_at: now() };
        state.attachments.push(att);
        if (RECETTE && f.blob) fileStore('put', att.id, f.blob);
      });
    });
  }

  // ---------- Version de test : fichiers réels ----------
  // Pièces jointes conservées dans le navigateur (IndexedDB), exports CSV identiques à ceux du serveur
  function fileStore(op, id, blob) {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open(KEY + '-fichiers', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('f'); };
        req.onerror = function () { resolve(null); };
        req.onsuccess = function () {
          var tx = req.result.transaction('f', op === 'put' ? 'readwrite' : 'readonly');
          var st = tx.objectStore('f');
          var r = op === 'put' ? st.put(blob, id) : op === 'clear' ? null : st.get(id);
          if (op === 'clear') { req.result.close(); return resolve(null); }
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { resolve(null); };
        };
      } catch (e) { resolve(null); }
    });
  }
  function saveFile(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function downloadAttachment(id) {
    var att = state.attachments.find(function (x) { return x.id === id; });
    if (!att) return;
    var samples = window.DEMO_SAMPLES || {};
    if (att.sample && samples[att.sample]) {
      fetch(samples[att.sample]).then(function (r) { return r.blob(); }).then(function (b) { saveFile(att.filename, b); });
      return;
    }
    fileStore('get', id).then(function (b) {
      if (b) saveFile(att.filename, b);
      else alertBox('Ce fichier n’est plus disponible dans ce navigateur.');
    });
  }
  function alertBox(msg) {
    var main = root.querySelector('main') || root;
    var d = document.createElement('div'); d.className = 'alert error'; d.setAttribute('role', 'alert'); d.textContent = msg;
    main.insertBefore(d, main.firstChild); window.scrollTo(0, 0);
  }
  var csvCell = function (v) {
    var x = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; // neutralise l'injection de formules dans les tableurs
    return '"' + x.replace(/"/g, '""') + '"';
  };
  // Identifiant non réversible du dossier (export statistique)
  function pseudoId(id) {
    var h = sha1(new TextEncoder().encode('ffsa-test:dossier:' + id));
    return Array.prototype.map.call(h, function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 12);
  }
  function downloadCsv(kind, accidents) {
    var rows = [];
    accidents.slice().sort(function (x, y) { return x.created_at < y.created_at ? (kind === 'pseudo' ? -1 : 1) : (kind === 'pseudo' ? 1 : -1); }).forEach(function (a) {
      var meds = state.medical.filter(function (x) { return x.accident_id === a.id; });
      (meds.length ? meds : [null]).forEach(function (m) { rows.push({ a: a, m: m ? m.data : {} }); });
    });
    var lines;
    if (kind === 'pseudo') {
      var pa = engine.pseudonymizedColumns(accidentForm), pm = engine.pseudonymizedColumns(medicalForm);
      lines = [['Pseudonyme dossier', 'Statut', 'Âge du patient'].concat(pa.map(function (c) { return 'Accident – ' + c.label; }), pm.map(function (c) { return 'Médical – ' + c.label; })).map(csvCell).join(';')];
      rows.forEach(function (r) {
        lines.push([pseudoId(r.a.id), STATUS_LABELS[r.a.status] || r.a.status, engine.ageAt(r.m.birthdate, r.m.date || r.a.data.accident_date)]
          .concat(pa.map(function (c) { return c.value(r.a.data); }), pm.map(function (c) { return c.value(r.m); })).map(csvCell).join(';'));
      });
    } else {
      var ca = engine.exportColumns(accidentForm), cm = engine.exportColumns(medicalForm);
      lines = [['Référence', 'Statut', 'Suivi', 'Déclaré le', 'Complété le'].concat(ca.map(function (c) { return 'Accident – ' + c.label; }), cm.map(function (c) { return 'Médical – ' + c.label; })).map(csvCell).join(';')];
      rows.forEach(function (r) {
        lines.push([r.a.reference, STATUS_LABELS[r.a.status] || r.a.status, PROCESSING[r.a.processing_status] || '', r.a.created_at, r.a.completed_at || '']
          .concat(ca.map(function (c) { return c.value(r.a.data); }), cm.map(function (c) { return c.value(r.m); })).map(csvCell).join(';'));
      });
    }
    var day = new Date().toISOString().slice(0, 10);
    saveFile(kind === 'pseudo' ? 'ffsa-statistiques-pseudonymisees-' + day + '.csv' : 'ffsa-dossiers-' + day + '.csv',
      new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  }

  // ---------- Rendu ----------
  var root = document.getElementById('app');
  var currentPath = '/connexion';
  // Les gabarits n'incluent que des partiels : '../partials/x' depuis une vue, 'x' depuis un partiel.
  // (Pas d'option filename : la version navigateur d'EJS n'a pas accès au disque.)
  function includer(originalPath) {
    var key = String(originalPath).replace(/^(\.\.\/)+/, '');
    if (key.indexOf('/') === -1) key = 'partials/' + key;
    if (!TEMPLATES[key]) throw new Error('Gabarit introuvable : ' + originalPath);
    return { template: TEMPLATES[key] };
  }
  function render(name, locals) {
    var u = currentUser();
    var data = Object.assign({
      user: u, csrfToken: 'demo', path: currentPath, demoMode: !RECETTE, testMode: RECETTE, appName: 'FFSA',
      maxUploadMb: 10,
      sectionHasValues: engine.sectionHasValues, disciplineClass: disciplineClass,
    }, locals);
    var html = ejs.render(TEMPLATES[name], data, { includer: includer });
    // Ressources : fichiers publiés à côté de la page, ou intégrées (version autonome en un seul fichier)
    var assets = window.DEMO_ASSETS || {};
    html = html.replace(/"\/static\/([^"]+)"/g, function (m, p) { return '"' + (assets[p] || 'static/' + p) + '"'; });
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script').forEach(function (s) { s.remove(); });
    root.innerHTML = doc.body.innerHTML;
    document.title = (locals.title || 'FFSA') + (RECETTE ? ' – FFSA' : ' – Démo FFSA');
    runAppScript();
  }
  function runAppScript() { try { new Function(APP_JS)(); } catch (e) { console.error(e); } }

  function go(method, url, body, files) {
    var u = new URL(url, 'https://demo.local');
    var query = Object.fromEntries(u.searchParams.entries());
    var res, previousPath = currentPath;
    for (var hops = 0; hops < 5; hops++) {
      currentPath = u.pathname;
      res = handle(method, u.pathname, query, body || {}, files || {});
      // Téléchargement ou impression : la page affichée ne change pas
      if (res.stay) { currentPath = previousPath; save(); return; }
      if (!res.redirect) break;
      u = new URL(res.redirect, 'https://demo.local');
      query = Object.fromEntries(u.searchParams.entries());
      method = 'GET'; body = {}; files = {};
    }
    state.lastUrl = u.pathname + u.search;
    save();
    render(res.view, res.locals);
    window.scrollTo(0, 0);
  }

  function disciplineClass(d) {
    d = String(d || '').toLowerCase();
    if (d.indexOf('karting') > -1) return 'disc-karting';
    if (d.indexOf('drift') > -1) return 'disc-drift';
    if (d.indexOf('tout-terrain') > -1 || d.indexOf('tout terrain') > -1 || /cross|trial|fol/.test(d)) return 'disc-tt';
    if (d.indexOf('côte') > -1 || d.indexOf('slalom') > -1) return 'disc-montagne';
    if (d.indexOf('vhc') > -1) return 'disc-vhc';
    if (d.indexOf('rallye') > -1) return 'disc-rallye';
    if (d.indexOf('circuit') > -1 || d.indexOf('dragster') > -1) return 'disc-circuit';
    return '';
  }

  // Navigation : liens internes et formulaires
  root.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href.charAt(0) === '/' || href.charAt(0) === '?') {
      e.preventDefault();
      go('GET', href.charAt(0) === '?' ? currentPath + href : href);
    }
  });
  root.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var form = e.target;
    e.preventDefault();
    var fd = new FormData(form, e.submitter || undefined);
    var method = (form.getAttribute('method') || 'GET').toUpperCase();
    var action = form.getAttribute('action') || currentPath;
    if (method === 'GET') {
      var qs = new URLSearchParams();
      fd.forEach(function (v, k) { if (v) qs.append(k, v); });
      return go('GET', action + (qs.toString() ? '?' + qs.toString() : ''));
    }
    var body = {}, files = {};
    fd.forEach(function (v, k) {
      if (v instanceof File) { if (v.name && v.size) (files[k] = files[k] || []).push({ originalname: v.name, size: v.size, mimetype: v.type, blob: RECETTE ? v : null }); return; }
      if (k in body) body[k] = [].concat(body[k], v); else body[k] = v;
    });
    go('POST', action, body, files);
  });

  // Enregistrement automatique des brouillons : intercepté et conservé dans le navigateur
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    var u = new URL(String(url), 'https://demo.local');
    var key = null, form = null;
    var cu = currentUser();
    if (u.pathname === '/organisateur/brouillon' && cu) { key = 'accident:' + cu.id; form = accidentForm; }
    var dm = u.pathname.match(/^\/medecin\/(\w+)\/brouillon$/);
    if (dm) {
      var r = state.requests.find(function (x) { return x.token === dm[1]; });
      if (r) { var ps = declaredPersons(accidentById(r.accident_id).data); var p = u.searchParams.get('p'); key = 'medical:' + r.accident_id + ':' + (ps.some(function (x) { return x.key === p; }) ? p : 'autre'); form = medicalForm; }
    }
    if (!key) {
      // Brouillon demandé hors session (ex. après déconnexion) : refusé, comme le ferait le serveur
      if (/\/brouillon$/.test(u.pathname)) return Promise.resolve(new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }));
      return realFetch ? realFetch(url, opts) : Promise.reject(new Error('fetch'));
    }
    var data = JSON.parse((opts && opts.body) || '{}');
    state.drafts[key] = { values: engine.draftValues(form, data), updatedAt: now() };
    save();
    return Promise.resolve(new Response(JSON.stringify({ savedAt: now() }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };

  // Les fenêtres de confirmation natives sont bloquées dans la démo : on confirme d'office
  window.confirm = function () { return true; };

  // Guide « Comment tester » : démo uniquement (absent de la version de test)
  var guide = document.getElementById('demo-guide');
  var help = document.getElementById('demo-help');
  function toggleGuide(open) {
    if (!guide || !help) return;
    guide.hidden = !open;
    help.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem(KEY + '-guide', open ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  if (help) help.addEventListener('click', function () { toggleGuide(guide.hidden); });
  var guidePref = null;
  try { guidePref = localStorage.getItem(KEY + '-guide'); } catch (e) { /* ignore */ }
  toggleGuide(guidePref !== '0'); // ouvert à la première visite

  // Remise à zéro des données (dossiers, comptes, fichiers) ; dans la version de test : deux clics
  var resetBtn = document.getElementById('demo-reset'), resetTimer;
  resetBtn.addEventListener('click', function () {
    if (RECETTE && !resetBtn.classList.contains('dn-confirm')) {
      resetBtn.classList.add('dn-confirm'); resetBtn.textContent = 'Confirmer la remise à zéro';
      resetTimer = setTimeout(function () { resetBtn.classList.remove('dn-confirm'); resetBtn.textContent = 'Réinitialiser les données'; }, 4000);
      return;
    }
    clearTimeout(resetTimer);
    if (RECETTE) { resetBtn.classList.remove('dn-confirm'); resetBtn.textContent = 'Réinitialiser les données'; try { indexedDB.deleteDatabase(KEY + '-fichiers'); } catch (e) { /* ignore */ } }
    seed();
    state.session = {};
    go('GET', '/connexion');
  });

  // ---------- Notes de réunion : remarques rattachées à l'écran affiché, exportables ----------
  // Conservées à part des données de démo : « Réinitialiser » ne les efface pas.
  var NOTES_KEY = KEY + '-notes';
  var notes = [];
  try { notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'); } catch (e) { notes = []; }
  var notesPanel = document.getElementById('demo-notes');
  var notesBtn = document.getElementById('demo-notes-btn');
  var notesCount = document.getElementById('demo-notes-count');
  var noteText = document.getElementById('demo-note-text');
  var noteAuthor = document.getElementById('demo-note-author');
  var noteScreen = document.getElementById('demo-note-screen');
  var noteTarget = document.getElementById('demo-note-target');
  var notesList = document.getElementById('demo-notes-list');
  var notesStatus = document.getElementById('demo-notes-status');
  var pickedElement = '';
  try { noteAuthor.value = localStorage.getItem(NOTES_KEY + '-author') || ''; } catch (e) { /* ignore */ }
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ROLES = { organizer: 'Directeur de course', medical: 'Service médical', admin: 'Administrateur' };
  function screenInfo() {
    var h = root.querySelector('h1');
    var u = currentUser();
    return {
      screen: (h ? h.textContent : document.title.replace(/ – (Démo )?FFSA$/, '')).replace(/\s+/g, ' ').trim(),
      path: state.lastUrl || currentPath,
      role: /^\/medecin\//.test(currentPath) ? 'Médecin' : u ? ROLES[u.role] || u.role : 'Non connecté',
    };
  }
  function saveNotes() { try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch (e) { /* ignore */ } }
  function refreshNotes() {
    var si = screenInfo();
    noteScreen.textContent = si.screen + ' · ' + si.role;
    noteTarget.hidden = !pickedElement;
    noteTarget.querySelector('span').textContent = pickedElement;
    notesCount.textContent = notes.length ? String(notes.length) : '';
    notesCount.hidden = !notes.length;
    notesList.innerHTML = notes.length ? notes.map(function (n, i) {
      return '<li><div class="dn-meta"><b>' + (i + 1) + '. ' + esc(n.screen) + '</b> · ' + esc(n.role) + (n.author ? ' · ' + esc(n.author) : '') + '</div>'
        + (n.element ? '<div class="dn-el">Élément : ' + esc(n.element) + '</div>' : '')
        + '<div class="dn-text">' + esc(n.text) + '</div>'
        + '<div class="dn-actions"><a href="#" data-note-go="' + i + '">Revoir l\'écran</a><a href="#" data-note-del="' + i + '">Supprimer</a></div></li>';
    }).join('') : '<li class="dn-empty">Aucune note pour l\'instant.</li>';
  }
  function toggleNotes(open) {
    notesPanel.hidden = !open;
    notesBtn.setAttribute('aria-expanded', String(open));
    if (open) { toggleGuide(false); refreshNotes(); noteText.focus(); }
  }
  notesBtn.addEventListener('click', function () { toggleNotes(notesPanel.hidden); });
  document.getElementById('demo-notes-close').addEventListener('click', function () { toggleNotes(false); });
  if (help) help.addEventListener('click', function () { if (!guide.hidden) toggleNotes(false); });
  function addNote() {
    var text = noteText.value.trim();
    if (!text) { noteText.focus(); return; }
    var si = screenInfo();
    notes.push({ at: now(), screen: si.screen, path: si.path, role: si.role, element: pickedElement, author: noteAuthor.value.trim(), text: text });
    saveNotes();
    noteText.value = ''; pickedElement = '';
    refreshNotes();
    notesList.lastElementChild.scrollIntoView({ block: 'nearest' });
    flash('Note ajoutée.');
  }
  document.getElementById('demo-note-add').addEventListener('click', addNote);
  noteText.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addNote(); } });
  noteAuthor.addEventListener('change', function () { try { localStorage.setItem(NOTES_KEY + '-author', noteAuthor.value.trim()); } catch (e) { /* ignore */ } });
  noteTarget.querySelector('button').addEventListener('click', function () { pickedElement = ''; refreshNotes(); });
  notesList.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.hasAttribute('data-note-del')) { notes.splice(+a.getAttribute('data-note-del'), 1); saveNotes(); refreshNotes(); }
    if (a.hasAttribute('data-note-go')) { go('GET', notes[+a.getAttribute('data-note-go')].path); refreshNotes(); }
  });
  var flashTimer;
  function flash(msg) { notesStatus.textContent = msg; clearTimeout(flashTimer); flashTimer = setTimeout(function () { notesStatus.textContent = ''; }, 3000); }

  // Désigner un élément de l'écran (bouton, champ, titre…) auquel rattacher la note
  var picking = false, hovered = null;
  function describe(el) {
    var field = el.closest('.field, label, fieldset');
    var lab = field && (field.querySelector('label, legend, .label') || field);
    var txt = (lab && lab !== root ? lab.textContent : '') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.getAttribute('value') || '';
    txt = txt.replace(/\s+/g, ' ').trim();
    if (!txt) txt = el.tagName.toLowerCase();
    return txt.length > 90 ? txt.slice(0, 87) + '…' : txt;
  }
  function setHover(el) { if (hovered) hovered.classList.remove('dn-hover'); hovered = el; if (el) el.classList.add('dn-hover'); }
  function stopPicking() { picking = false; setHover(null); document.body.classList.remove('dn-picking'); }
  document.getElementById('demo-note-pick').addEventListener('click', function () {
    picking = true;
    document.body.classList.add('dn-picking');
    notesPanel.hidden = true;
    flash('');
  });
  root.addEventListener('mouseover', function (e) { if (picking) setHover(e.target.closest('button, a, input, select, textarea, label, h1, h2, h3, th, td, p, li, .card, .field') || e.target); });
  document.addEventListener('click', function (e) {
    if (!picking || !root.contains(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    pickedElement = describe(e.target.closest('button, a, input, select, textarea, label, h1, h2, h3, th, td, p, li, .card, .field') || e.target);
    stopPicking();
    toggleNotes(true);
  }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && picking) { stopPicking(); toggleNotes(true); } });

  // Export : texte lisible, à coller dans un e-mail ou à transmettre pour les modifications
  function exportText() {
    var d = new Date();
    var lines = [RECETTE ? 'Notes de test FFSA Médical' : 'Notes sur la démo FFSA Médical', 'Exportées le ' + d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + ' · ' + notes.length + ' note(s)', ''];
    notes.forEach(function (n, i) {
      lines.push((i + 1) + '. ' + n.screen + ' (' + n.role + ')');
      lines.push('   Écran : ' + n.path);
      if (n.element) lines.push('   Élément : ' + n.element);
      if (n.author) lines.push('   Par : ' + n.author);
      lines.push('   Le ' + new Date(n.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }));
      n.text.split('\n').forEach(function (l) { lines.push('   ' + l); });
      lines.push('');
    });
    return lines.join('\n');
  }
  document.getElementById('demo-notes-download').addEventListener('click', function () {
    if (!notes.length) return flash('Aucune note à exporter.');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + exportText()], { type: 'text/plain;charset=utf-8' }));
    a.download = 'notes-demo-ffsa-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    flash('Fichier téléchargé.');
  });
  document.getElementById('demo-notes-copy').addEventListener('click', function () {
    if (!notes.length) return flash('Aucune note à copier.');
    var text = exportText();
    var fallback = function () {
      var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); flash('Notes copiées.'); } catch (e) { flash('Copie impossible : utilisez Télécharger.'); }
      t.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash('Notes copiées.'); }, fallback);
    else fallback();
  });
  // Effacement en deux clics (les fenêtres natives peuvent être bloquées selon l'hébergement)
  var clearBtn = document.getElementById('demo-notes-clear'), clearTimer;
  clearBtn.addEventListener('click', function () {
    if (!notes.length) return;
    if (!clearBtn.classList.contains('dn-confirm')) {
      clearBtn.classList.add('dn-confirm'); clearBtn.textContent = 'Confirmer ?';
      clearTimer = setTimeout(function () { clearBtn.classList.remove('dn-confirm'); clearBtn.textContent = 'Tout effacer'; }, 4000);
      return;
    }
    clearTimeout(clearTimer); clearBtn.classList.remove('dn-confirm'); clearBtn.textContent = 'Tout effacer';
    notes = []; saveNotes(); refreshNotes(); flash('Notes effacées.');
  });
  var renderBase = render;
  render = function (name, locals) { renderBase(name, locals); if (!notesPanel.hidden || notes.length) refreshNotes(); };

  state = load();
  if (!state || !state.users || !state.drafts || !state.users.some(function (x) { return x.approval_status; })) seed(); // données d'une ancienne version : on repart à zéro
  go('GET', state.lastUrl || '/connexion');
})();
