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
  var SSO_LABEL = 'Se connecter avec mon compte licencié FFSA (simulation)';
  // Licenciés fictifs du portail simulé (identiques à src/sso-demo-idp.js)
  var LICENSEES = [
    { sub: 'lic-201501', given_name: 'Camille', family_name: 'Laurent', email: 'camille.laurent@asa-demo.fr', licence: '201501', asa: 'ASA Démo Ouest' },
    { sub: 'lic-178842', given_name: 'Karim', family_name: 'Benali', email: 'karim.benali@asa-demo.fr', licence: '178842', asa: 'ASA Démo Sud' },
  ];
  var PROCESSING = { a_analyser: 'À analyser', en_cours: 'En cours', clos: 'Clos' };

  // ---------- Stockage local ----------
  var KEY = 'ffsa-demo-v1';
  var PASSWORD = 'Demo-FFSA-2026!';
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
    mail(tpl || 'doctorInvitation', r.doctorEmail, { reference: a.reference, eventName: a.event_name, link: link, expiresAt: new Date(r.expires_at).toLocaleDateString('fr-FR') });
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
    var a = { id: id, reference: ref, organizer_id: organizer.id, status: 'awaiting_medical', event_name: values.event_name, event_date: values.event_date || null, discipline: values.discipline || null, data: values, created_at: now(), completed_at: null, processing_status: 'a_analyser', assigned_to: null };
    state.accidents.unshift(a);
    var r = createRequest(a, values.doctor_email, values.doctor_phone);
    var ctx = { reference: ref, eventName: a.event_name };
    invite(r, a);
    mail('organizerConfirmation', organizer.email, ctx);
    mail('serviceNewAccident', 'service.medical@ffsa.fr', { reference: ref, eventName: a.event_name, link: '/back-office/dossiers/' + id });
    return a;
  }
  function createRequest(a, email, phone, from) {
    state.requests.forEach(function (r) { if (r.accident_id === a.id && !r.revoked_at && !r.used_at) r.revoked_at = now(); });
    var r = { id: uuid(), accident_id: a.id, doctorEmail: email, doctorPhone: phone || null, transferred_from: from || null, token: rnd(24), expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), sent_at: now(), reminder_sent_at: null, revoked_at: null, used_at: null, otp: null, otp_expires: 0 };
    state.requests.push(r);
    return r;
  }
  function finish(a) {
    state.requests.forEach(function (r) { if (r.accident_id === a.id && !r.used_at) r.used_at = now(); });
    a.status = 'complete'; a.completed_at = now();
    mail('serviceComplete', 'service.medical@ffsa.fr', { reference: a.reference, eventName: a.event_name, link: '/back-office/dossiers/' + a.id });
  }

  function seed() {
    state = { seq: 0, users: [], accidents: [], requests: [], medical: [], attachments: [], mails: [], audit: [], notes: [], drafts: {}, session: {} };
    [['organisateur@demo.ffsa.fr', 'Organisateur Démo', 'organizer', false], ['medical@demo.ffsa.fr', 'Service médical Démo', 'medical', true], ['admin@demo.ffsa.fr', 'Administrateur Démo', 'admin', true]]
      .forEach(function (u) { state.users.push({ id: uuid(), email: u[0], full_name: u[1], role: u[2], password: PASSWORD, totp_enabled: u[3], active: true, activated: true, auth_source: 'local', approval_status: 'approved', email_verified_at: now(), last_login_at: null, created_at: now(), organization: u[2] === 'organizer' ? 'ASA Démo (exemple)' : null }); });
    // Une demande d'accès en attente, pour montrer la validation
    state.users.push({ id: uuid(), email: 'julie.moreau@club-demo.fr', full_name: 'Julie Moreau', role: 'organizer', password: PASSWORD, totp_enabled: false, active: true, activated: true,
      auth_source: 'local', approval_status: 'pending', email_verified_at: now(), phone: '06 98 76 54 32', organization: 'Écurie du Val (exemple)', job_title: 'Organisateur / ASA',
      license_number: null, signup_message: 'Organisation du slalom du Val en juin.', created_at: now() });
    var orga = state.users[0];
    var base = { doctor_first_name: 'Claire', doctor_last_name: 'Moreau', doctor_email: 'dr.moreau@demo.ffsa.fr', doctor_phone: '06 12 34 56 78', author_first_name: 'Jean', author_last_name: 'Martin', author_role: 'Directeur de course' };
    var a1 = createAccident(orga, Object.assign({}, base, {
      event_name: 'Rallye des Vosges (exemple)', event_location: 'Gérardmer', discipline: 'Rallye', event_level: 'Épreuve nationale',
      event_date: '2026-09-20', accident_date: '2026-09-20', accident_time: '14:35', summary_victim_last_name: 'Exemple', summary_victim_first_name: 'Paul',
      circumstances: 'Sortie de route en ES3, tonneau. Pilote extrait par l’équipe d’intervention.', hospitalised_count: 1, deaths_count: 0,
      casualties: { Pilotes: { 'Nombre de blessés': 1 } }, vehicle1_driver_role: 'Pilote', vehicle1_driver_last_name: 'Exemple', vehicle1_driver_first_name: 'Paul', vehicle1_number: '27', vehicle1_license: '254781', vehicle1_vehicle_type: 'Voiture de tourisme (y compris SUV et 4x4)',
      weather: ['Nuageux'], surface: ['Asphalte'], track_condition: ['Mouillé'],
    }));
    createAccident(orga, Object.assign({}, base, {
      event_name: 'Course de côte du Mont-Dore (exemple)', event_location: 'Le Mont-Dore', discipline: 'Course de côte',
      event_date: '2026-09-27', accident_date: '2026-09-27', accident_time: '10:05', summary_victim_last_name: 'Exemple', summary_victim_first_name: 'Léa', vehicle1_driver_role: 'Pilote', vehicle1_driver_last_name: 'Exemple', vehicle1_driver_first_name: 'Léa', vehicle1_number: '112', vehicle1_license: '287654',
      circumstances: 'Choc latéral contre le rail au virage 7.',
    }));
    state.medical.push({ id: uuid(), accident_id: a1.id, patient_ref: 'vehicle1', created_at: now(), data: {
      date: '2026-09-20', time: '14:35', place: 'Gérardmer', event: 'Rallye des Vosges (exemple)',
      patient_last_name: 'Exemple', patient_first_name: 'Paul', patient_type: ['Pilote'], bp: '130/80', pulse: '92', glasgow: '15',
      upper_limbs: { Clavicule: { Droite: 'F' } }, spine: ['Cervical'], decision: ['Évacuation non urgente', 'Imagerie'],
      hospital: 'CHU de Nancy', diagnosis: 'Fracture de la clavicule droite suspectée.', classification: "2 : transfert à l'hôpital",
      unfit: 'Non (pas de suspension de licence)', current_event: 'Inapte à reprendre', doctor_name: 'Claire Moreau' } });
    finish(a1);
    // Le second dossier date de 3 jours : il apparaît « en retard » dans le back office
    state.accidents.forEach(function (a) { if (a.status === 'awaiting_medical') a.created_at = new Date(Date.now() - 3 * 864e5).toISOString(); });
    state.mails = [];
    state.audit = [];
    save();
  }

  // ---------- Helpers « serveur » ----------
  var ROLE_LABELS = { organizer: 'Organisateur', medical: 'Service médical (accès aux données de santé)', admin: 'Administrateur (comptes et journal, sans données de santé)' };
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
  // Code de double authentification simulé : change chaque minute, affiché à l'écran
  var demoCode = function (offset) { var t = Math.floor(Date.now() / 60000) - (offset || 0); return String((t * 104729) % 900000 + 100000); };
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
    if (msg) return { stop: view('errors/info', { title: 'Rapport médical', message: msg }, 410) };
    var acc = state.session.doctorAccess;
    return { r: r, a: a, verified: Boolean(acc && acc.requestId === r.id && acc.until > Date.now()) };
  }

  function verifyLocals(ctx, codeSent, error) {
    return { title: 'Vérification', reference: ctx.a.reference, maskedEmail: maskEmail(ctx.r.doctorEmail), maskedPhone: ctx.r.doctorPhone ? maskPhone(ctx.r.doctorPhone) : null, codeSent: codeSent, error: error || null, token: ctx.r.token };
  }

  var isOverdue = function (a) { return a.status === 'awaiting_medical' && Date.now() - new Date(a.created_at) > 48 * 3600e3; };
  var draftLocals = function (url, discard, key) { var d = state.drafts[key]; return { draftUrl: url, discardUrl: discard, draftSavedAt: d ? d.updatedAt : null }; };
  function filtered(q) {
    return state.accidents.filter(function (a) {
      if (q.statut && a.status !== q.statut) return false;
      if (q.discipline && a.discipline !== q.discipline) return false;
      if (q.du && (!a.event_date || a.event_date < q.du)) return false;
      if (q.au && (!a.event_date || a.event_date > q.au)) return false;
      if (q.q) { var s = q.q.toLowerCase(); if (a.reference.toLowerCase().indexOf(s) === -1 && a.event_name.toLowerCase().indexOf(s) === -1) return false; }
      if (q.suivi && a.processing_status !== q.suivi) return false;
      if (q.attribue === 'moi' && a.assigned_to !== state.session.userId) return false;
      if (q.attribue === 'personne' && a.assigned_to) return false;
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
      return view('auth/login', { title: 'Connexion', error: null, email: '', demoAccounts: demoAccounts(), ssoLabel: SSO_LABEL });
    }
    if (path === '/connexion' && method === 'POST') {
      var email = String(body.email || '').trim().toLowerCase();
      var found = state.users.find(function (x) { return x.email === email && x.active; });
      var loginErr = function (msg) { return view('auth/login', { title: 'Connexion', error: msg, email: email, demoAccounts: demoAccounts(), ssoLabel: SSO_LABEL }, 401); };
      if (!found || !found.password || found.password !== body.password) return loginErr('Identifiants incorrects.');
      if (found.approval_status === 'rejected') return loginErr("Votre demande de compte n'a pas été acceptée. Contactez le service médical de la FFSA.");
      if (found.approval_status === 'pending' && !found.email_verified_at) {
        found.verifyToken = rnd(24);
        mail('signupVerify', found.email, { name: found.full_name, link: '/inscription/confirmer/' + found.verifyToken });
        return loginErr('Confirmez d’abord votre adresse e-mail : un nouveau lien de confirmation vient de vous être envoyé.');
      }
      if (found.approval_status === 'pending') return loginErr('Votre demande de compte est en cours de validation par la FFSA. Vous serez prévenu(e) par e-mail.');
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
    // Connexion par compte licencié (portail simulé)
    if (path === '/connexion/2fa/renvoyer' && method === 'POST') {
      var ru2 = state.users.find(function (x) { return x.id === state.session.mfaUserId; });
      if (!ru2 || state.session.mfaMethod !== 'email') return redirect('/connexion');
      beginMfa(ru2);
      return redirect('/connexion/2fa?renvoye=1');
    }
    if (path === '/donnees-personnelles') return view('legal/privacy', { title: 'Données personnelles', retentionYears: 10,
      privacy: { controller: 'Fédération Française du Sport Automobile (FFSA) [adresse du siège à compléter]', dpoContact: '[adresse de contact du délégué à la protection des données à compléter]', legalBasis: '', validated: false } });
    if (path === '/connexion/sso') return view('demo/sso', { title: 'Portail licenciés FFSA (simulation)', licensees: LICENSEES, q: { client_id: 'demo', redirect_uri: '', state: '', nonce: '', code_challenge: '' } });
    if (path === '/demo/sso/authorize' && method === 'POST') {
      var lic = LICENSEES.find(function (l) { return l.sub === body.sub; });
      if (!lic) return notFound();
      var su = state.users.find(function (x) { return x.sso_subject === lic.sub; }) || state.users.find(function (x) { return x.email === lic.email; });
      if (su && su.role !== 'organizer') return view('errors/error', { title: 'Connexion impossible', message: 'Cette adresse correspond à un compte du service médical : connectez-vous avec votre mot de passe et votre code de double authentification.' }, 409);
      if (su) { su.sso_subject = lic.sub; su.license_number = lic.licence; su.organization = lic.asa; if (su.approval_status === 'pending') su.approval_status = 'approved'; }
      else {
        su = { id: uuid(), email: lic.email, full_name: lic.given_name + ' ' + lic.family_name, role: 'organizer', password: null, totp_enabled: false, active: true, activated: true,
          auth_source: 'sso', sso_subject: lic.sub, license_number: lic.licence, organization: lic.asa, approval_status: 'approved', email_verified_at: now(), created_at: now() };
        state.users.push(su);
        audit('sso_account_created', 'user', su.id);
      }
      return beginMfa(su);
    }
    // Inscription libre
    if (path === '/inscription') {
      var signupLocals = function (extra) { return Object.assign({ title: 'Créer un compte organisateur', values: {}, errors: {}, formError: null, jobTitles: signupRules.JOB_TITLES, ssoLabel: SSO_LABEL }, extra); };
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
          auth_source: 'local', approval_status: 'pending', email_verified_at: null, phone: sv.v.phone, organization: sv.v.organization, job_title: sv.v.job_title,
          license_number: sv.v.license_number || null, signup_message: sv.v.message || null, created_at: now(), verifyToken: rnd(24) };
        state.users.push(nu2);
        mail('signupVerify', nu2.email, { name: nu2.full_name, link: '/inscription/confirmer/' + nu2.verifyToken });
      }
      return view('auth/signup-done', { title: 'Vérifiez votre boîte mail', email: sv.v.email });
    }
    if ((m = path.match(/^\/inscription\/confirmer\/(\w+)$/))) {
      var vu = state.users.find(function (x) { return x.verifyToken && x.verifyToken === m[1]; });
      if (!vu) return view('errors/error', { title: 'Lien invalide', message: 'Ce lien de confirmation est invalide ou a expiré. Connectez-vous pour en recevoir un nouveau.' }, 410);
      vu.email_verified_at = now(); delete vu.verifyToken;
      mail('signupToReview', 'service.medical@ffsa.fr', { name: vu.full_name, organization: vu.organization || '—', link: '/back-office/demandes' });
      return info('Adresse confirmée', 'Merci. Votre demande de compte organisateur est maintenant transmise à la FFSA pour validation. Vous recevrez un e-mail dès qu’elle sera acceptée.');
    }
    if (path === '/deconnexion' && method === 'POST') { audit('logout'); state.session = {}; return redirect('/connexion'); }
    if (path === '/mot-de-passe-oublie') return view('auth/forgot', { title: 'Mot de passe oublié', sent: method === 'POST' });
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
      return info('Double authentification', "Dans l'application, l'utilisateur scanne ici un QR code avec son téléphone. Cette étape n'est pas simulée dans la démo en ligne.");
    }

    // Organisateur
    if (path.indexOf('/organisateur') === 0) {
      var stop = requireRole(['organizer']); if (stop) return stop;
      if (path === '/organisateur') {
        var mine = state.accidents.filter(function (a) { return a.organizer_id === u.id; });
        return view('organizer/index', { title: 'Mes déclarations', reports: mine, created: query.cree || null });
      }
      var okey = 'accident:' + u.id;
      if (path === '/organisateur/brouillon/supprimer' && method === 'POST') { delete state.drafts[okey]; return redirect('/organisateur/rapports/nouveau'); }
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
      if (sub === '/transferer' && method === 'POST') {
        var temail = String(body.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(temail)) return redirect('/medecin/' + token + '?transfert=invalide');
        var nr = createRequest(ctx.a, temail, String(body.phone || '').trim() || null, ctx.r.id);
        invite(nr, ctx.a, 'doctorTransfer');
        audit('doctor_transferred', 'accident', ctx.a.id);
        delete state.session.doctorAccess;
        return info('Demande transmise', 'La demande de rapport médical du dossier ' + ctx.a.reference + ' a été transmise à ' + temail + '. Votre lien est désormais désactivé ; les rapports déjà saisis sont conservés.');
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
        error: query.vide ? 'Ajoutez au moins un rapport patient avant de clôturer.' : query.transfert === 'invalide' ? 'Adresse e-mail du confrère invalide.' : null,
      });
    }

    // Back office
    if (path.indexOf('/back-office') === 0) {
      var st = requireRole(['medical', 'admin']); if (st) return st;
      // Données de santé : service médical uniquement ; l'administrateur gère les comptes et le journal
      if (u.role === 'admin' && (path === '/back-office' || path.indexOf('/back-office/dossiers') === 0 || path.indexOf('/back-office/export') === 0)) {
        return path === '/back-office' ? redirect('/back-office/utilisateurs') : denied();
      }
      if (path === '/back-office/export-pseudonymise.csv') return info('Export statistique pseudonymisé', "Dans l'application, ce bouton télécharge un tableur pour les statistiques : sans nom, coordonnées, texte libre ni signature, dates réduites au mois, âge calculé et identifiant de dossier non réversible. Le téléchargement de fichiers n'est pas possible dans cette démo en ligne.", '/back-office', 'Retour aux dossiers');
      if (path === '/back-office') {
        var list = filtered(query);
        var page = Math.max(1, Number(query.page) || 1);
        list.sort(function (x, y) { return (isOverdue(y) - isOverdue(x)) || (y.created_at > x.created_at ? 1 : -1); });
        var rows = list.slice((page - 1) * 50, page * 50).map(function (a) {
          var o = state.users.find(function (x) { return x.id === a.organizer_id; });
          var as = state.users.find(function (x) { return x.id === a.assigned_to; });
          return Object.assign({}, a, { organizer_name: o ? o.full_name : '', assignee_name: as ? as.full_name : null, overdue: isOverdue(a) });
        });
        var all = state.accidents;
        var stats = { total: all.length, overdue: all.filter(isOverdue).length, pending: all.filter(function (a) { return a.status === 'awaiting_medical'; }).length,
          to_review: all.filter(function (a) { return a.status === 'complete' && a.processing_status === 'a_analyser'; }).length,
          mine: all.filter(function (a) { return a.assigned_to === u.id && a.processing_status !== 'clos'; }).length };
        var eq = new URLSearchParams(Object.entries(query).filter(function (e) { return e[0] !== 'page' && e[1]; })).toString();
        return view('backoffice/index', { title: 'Dossiers', reports: rows, stats: stats, query: query, page: page, pages: Math.max(1, Math.ceil(list.length / 50)), total: list.length,
          disciplines: engine.allFields(accidentForm).find(function (f) { return f.name === 'discipline'; }).options, processing: PROCESSING, exportQuery: eq });
      }
      if (path === '/back-office/export.csv') return info('Export tableur', "L'export CSV (une ligne par patient, ouvrable dans Excel) fonctionne dans l'application. Le téléchargement de fichiers n'est pas possible dans cette démo en ligne.", '/back-office', 'Retour aux dossiers');
      if ((m = path.match(/^\/back-office\/dossiers\/([\w-]+)\/pdf\/\w+$/))) return info('Téléchargement PDF', "Dans l'application, ce bouton télécharge le dossier en PDF au format du rapport FFSA (en-tête et pied de page FFSA, rubriques du formulaire, signatures). Le téléchargement de fichiers n'est pas possible dans cette démo en ligne.", '/back-office/dossiers/' + m[1], 'Retour au dossier');
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
        sa.assigned_to = body.assigned_to || null;
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
          staff: state.users.filter(function (x) { return x.role === 'medical' && x.active; }),
          retentionEnd: (function () { var d = new Date(acc.created_at); d.setFullYear(d.getFullYear() + 10); return d; })(), retentionYears: 10,
          processing: PROCESSING, overdue: isOverdue(acc),
          flash: query.relance ? 'Nouvelle invitation envoyée au médecin.' : query.suivi ? 'Suivi mis à jour.' : query.note ? 'Note ajoutée.' : null,
        });
      }
      if (path === '/back-office/demandes') {
        var reqs = state.users.filter(function (x) { return x.role === 'organizer' && x.auth_source === 'local' && (x.approval_status !== 'approved' || x.reviewed_at); });
        return view('backoffice/requests', { title: "Demandes d'accès",
          pending: reqs.filter(function (x) { return x.approval_status === 'pending' && x.email_verified_at; }),
          unverified: reqs.filter(function (x) { return x.approval_status === 'pending' && !x.email_verified_at; }),
          reviewed: reqs.filter(function (x) { return x.approval_status !== 'pending'; }).map(function (x) {
            var rv = state.users.find(function (y) { return y.id === x.reviewed_by; }); return Object.assign({}, x, { reviewer: rv ? rv.full_name : null }); }),
          flash: query.ok || null });
      }
      if ((m = path.match(/^\/back-office\/demandes\/([\w-]+)\/(valider|refuser)$/)) && method === 'POST') {
        var ru = state.users.find(function (x) { return x.id === m[1] && x.approval_status === 'pending'; });
        if (!ru) return redirect('/back-office/demandes');
        ru.approval_status = m[2] === 'valider' ? 'approved' : 'rejected'; ru.reviewed_by = u.id; ru.reviewed_at = now(); ru.review_note = String(body.note || '').trim() || null;
        if (m[2] === 'valider') mail('signupApproved', ru.email, { name: ru.full_name, link: '/connexion' });
        else mail('signupRejected', ru.email, { name: ru.full_name, reason: ru.review_note });
        audit(m[2] === 'valider' ? 'signup_approved' : 'signup_rejected', 'user', ru.id);
        return redirect('/back-office/demandes?ok=' + encodeURIComponent(m[2] === 'valider' ? 'Compte de ' + ru.full_name + ' activé ; un e-mail lui a été envoyé.' : 'Demande de ' + ru.full_name + ' refusée.'));
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
    return [['organisateur@demo.ffsa.fr', 'Organisateur'], ['medical@demo.ffsa.fr', 'Service médical'], ['admin@demo.ffsa.fr', 'Administrateur (sans accès aux données de santé)']]
      .map(function (a) { return { email: a[0], label: a[1], password: PASSWORD }; });
  }
  function usersView(flash, error, status) {
    return view('backoffice/users', { title: 'Utilisateurs', roleLabels: ROLE_LABELS, flash: flash, error: error,
      users: state.users.slice().sort(function (a, b) { return a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name); }) }, status);
  }
  function addFiles(accidentId, source, files) {
    Object.keys(files).forEach(function (field) {
      files[field].forEach(function (f) { state.attachments.push({ id: uuid(), accident_id: accidentId, source: source, field: field, filename: f.originalname, mime_type: f.mimetype, size_bytes: f.size, created_at: now() }); });
    });
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
      user: u, csrfToken: 'demo', path: currentPath, demoMode: true, appName: 'FFSA',
      pendingRequests: u && u.role !== 'organizer' ? state.users.filter(function (x) { return x.approval_status === 'pending' && x.email_verified_at; }).length : 0,
      sectionHasValues: engine.sectionHasValues, disciplineClass: disciplineClass,
    }, locals);
    var html = ejs.render(TEMPLATES[name], data, { includer: includer });
    var doc = new DOMParser().parseFromString(html.split('"/static/').join('"static/'), 'text/html');
    doc.querySelectorAll('script').forEach(function (s) { s.remove(); });
    root.innerHTML = doc.body.innerHTML;
    document.title = (locals.title || 'FFSA') + ' – Démo FFSA';
    runAppScript();
  }
  function runAppScript() { try { new Function(APP_JS)(); } catch (e) { console.error(e); } }

  function go(method, url, body, files) {
    var u = new URL(url, 'https://demo.local');
    var query = Object.fromEntries(u.searchParams.entries());
    var res;
    for (var hops = 0; hops < 5; hops++) {
      currentPath = u.pathname;
      res = handle(method, u.pathname, query, body || {}, files || {});
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
      if (v instanceof File) { if (v.name && v.size) (files[k] = files[k] || []).push({ originalname: v.name, size: v.size, mimetype: v.type }); return; }
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
    if (!key) return realFetch ? realFetch(url, opts) : Promise.reject(new Error('fetch'));
    var data = JSON.parse((opts && opts.body) || '{}');
    state.drafts[key] = { values: engine.validate(form, data).raw, updatedAt: now() };
    save();
    return Promise.resolve(new Response(JSON.stringify({ savedAt: now() }), { status: 200, headers: { 'content-type': 'application/json' } }));
  };

  // Les fenêtres de confirmation natives sont bloquées dans la démo : on confirme d'office
  window.confirm = function () { return true; };

  var guide = document.getElementById('demo-guide');
  var help = document.getElementById('demo-help');
  function toggleGuide(open) {
    guide.hidden = !open;
    help.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem(KEY + '-guide', open ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  help.addEventListener('click', function () { toggleGuide(guide.hidden); });
  var guidePref = null;
  try { guidePref = localStorage.getItem(KEY + '-guide'); } catch (e) { /* ignore */ }
  toggleGuide(guidePref !== '0'); // ouvert à la première visite

  document.getElementById('demo-reset').addEventListener('click', function () {
    seed();
    state.session = {};
    go('GET', '/connexion');
  });

  state = load();
  if (!state || !state.users || !state.drafts || !state.users.some(function (x) { return x.approval_status; })) seed(); // données d'une ancienne version : on repart à zéro
  go('GET', state.lastUrl || '/connexion');
})();
