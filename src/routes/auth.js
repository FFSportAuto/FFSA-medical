'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const db = require('../db');
const audit = require('../lib/audit');
const mailer = require('../lib/mailer');
const totp = require('../lib/totp');
const config = require('../config');
const { verifyPassword, hashPassword, passwordPolicyError } = require('../lib/password');
const { encrypt, decryptText, hashToken, randomToken } = require('../lib/crypto');
const { requireLogin, homeFor } = require('../middleware/auth');
const sso = require('../lib/sso');
const accounts = require('../services/accounts');
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

const router = express.Router();
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

function startSession(req, user) {
  const returnTo = req.session.returnTo;
  return new Promise((resolve, reject) => {
    // Nouvel identifiant de session à chaque connexion (fixation de session)
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.createdAt = Date.now();
      resolve(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : homeFor(user));
    });
  });
}

router.get('/', (req, res) => res.redirect(homeFor(req.user)));

const demoAccounts = async () => (config.demoMode ? require('../demo').accountsForDisplay() : []);
const demoCode = async (userId) => (config.demoMode ? require('../demo').currentCode(userId) : null);

router.get('/connexion', async (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  res.render('auth/login', { title: 'Connexion', error: null, email: '', demoAccounts: await demoAccounts(), ssoLabel: sso.isEnabled() ? config.oidc.label : null });
});

router.post('/connexion', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await db.one('SELECT * FROM users WHERE email = $1', [email]);
  const fail = async (message = 'Identifiants incorrects.') => {
    await audit(req, 'login_failed', { targetType: 'user', targetId: user && user.id, actor: email || 'anonyme' });
    res.status(401).render('auth/login', { title: 'Connexion', error: message, email, demoAccounts: await demoAccounts(), ssoLabel: sso.isEnabled() ? config.oidc.label : null });
  };

  if (!user || !user.active) return fail();
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return fail(`Compte temporairement verrouillé suite à plusieurs échecs. Réessayez dans ${LOCK_MINUTES} minutes.`);
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const attempts = user.failed_attempts + 1;
    await db.query(
      `UPDATE users SET failed_attempts = CASE WHEN $2 >= ${MAX_FAILED} THEN 0 ELSE $2 END,
              locked_until = CASE WHEN $2 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE NULL END
        WHERE id = $1`,
      [user.id, attempts],
    );
    return fail();
  }
  await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);

  // Inscription libre : l'adresse doit être confirmée puis la demande validée par la FFSA
  if (user.approval_status !== 'approved') {
    if (user.approval_status === 'rejected') return fail("Votre demande de compte n'a pas été acceptée. Contactez le service médical de la FFSA.");
    if (!user.email_verified_at) {
      const token = await accounts.createToken(user.id, 'verify', 48);
      await mailer.send('signupVerify', user.email, { name: user.full_name, link: `${config.baseUrl}/inscription/confirmer/${token}` });
      return fail('Confirmez d’abord votre adresse e-mail : un nouveau lien de confirmation vient de vous être envoyé.');
    }
    return fail('Votre demande de compte est en cours de validation par la FFSA. Vous serez prévenu(e) par e-mail.');
  }

  if (user.totp_enabled) {
    req.session.mfaUserId = user.id;
    req.session.mfaAt = Date.now();
    return res.redirect('/connexion/2fa');
  }
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const target = await startSession(req, user);
  req.user = user;
  await audit(req, 'login');
  res.redirect(target);
});

router.get('/connexion/2fa', async (req, res) => {
  if (!req.session.mfaUserId) return res.redirect('/connexion');
  res.render('auth/totp', { title: 'Double authentification', error: null, demoCode: await demoCode(req.session.mfaUserId) });
});

router.post('/connexion/2fa', loginLimiter, async (req, res) => {
  const { mfaUserId, mfaAt } = req.session;
  if (!mfaUserId || Date.now() - mfaAt > 5 * 60 * 1000) return res.redirect('/connexion');
  const user = await db.one('SELECT * FROM users WHERE id = $1 AND active', [mfaUserId]);
  if (!user || !totp.verify(decryptText(user.totp_secret_enc), req.body.code)) {
    await audit(req, 'login_2fa_failed', { targetType: 'user', targetId: mfaUserId, actor: user ? user.email : 'anonyme' });
    return res.status(401).render('auth/totp', { title: 'Double authentification', error: 'Code incorrect.', demoCode: await demoCode(mfaUserId) });
  }
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const target = await startSession(req, user);
  req.user = user;
  await audit(req, 'login');
  res.redirect(target);
});

// ---- Connexion avec le compte licencié FFSA (OpenID Connect) ----

router.get('/connexion/sso', loginLimiter, async (req, res, next) => {
  if (!sso.isEnabled()) return next();
  try {
    res.redirect(await sso.authorizationUrl(req.session));
  } catch (err) {
    console.error('SSO indisponible :', err.message);
    res.status(503).render('errors/error', { title: 'Connexion indisponible', message: 'Le service de connexion des licenciés ne répond pas. Réessayez plus tard ou utilisez votre mot de passe.' });
  }
});

router.get('/connexion/sso/retour', loginLimiter, async (req, res, next) => {
  if (!sso.isEnabled()) return next();
  let identity;
  try {
    identity = await sso.handleCallback(req);
  } catch (err) {
    await audit(req, 'sso_failed', { details: { reason: err.code || err.message } });
    const message = err.code === 'NOT_ALLOWED'
      ? "Votre profil licencié ne permet pas d'accéder à l'application. Créez un compte organisateur avec le formulaire d'inscription."
      : 'La connexion avec votre compte licencié a échoué. Réessayez.';
    return res.status(401).render('errors/error', { title: 'Connexion impossible', message });
  }
  let result;
  try {
    result = await accounts.findOrCreateSsoUser(identity);
  } catch (err) {
    const message = err.code === 'STAFF_ACCOUNT'
      ? 'Cette adresse correspond à un compte du service médical : connectez-vous avec votre mot de passe et votre code de double authentification.'
      : err.message;
    return res.status(409).render('errors/error', { title: 'Connexion impossible', message });
  }
  const { user } = result;
  if (!user.active) return res.status(403).render('errors/error', { title: 'Compte désactivé', message: 'Votre compte a été désactivé. Contactez la FFSA.' });
  if (user.totp_enabled) {
    req.session.mfaUserId = user.id;
    req.session.mfaAt = Date.now();
    return res.redirect('/connexion/2fa');
  }
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const target = await startSession(req, user);
  req.user = user;
  await audit(req, result.created ? 'sso_account_created' : 'login_sso', { targetType: 'user', targetId: user.id });
  res.redirect(target);
});

// ---- Inscription libre (organisateurs sans compte licencié) ----

const signupView = (res, locals = {}, status = 200) =>
  res.status(status).render('auth/signup', {
    title: 'Créer un compte organisateur', values: {}, errors: {}, formError: null, jobTitles: accounts.JOB_TITLES,
    ssoLabel: sso.isEnabled() ? config.oidc.label : null, ...locals,
  });

router.get('/inscription', (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  signupView(res);
});

router.post('/inscription', signupLimiter, async (req, res) => {
  // Champ piège invisible : rempli uniquement par les robots
  if (req.body.website) return res.render('auth/signup-done', { title: 'Vérifiez votre boîte mail' });
  const { v, errors } = accounts.validateSignup(req.body);
  const { password, confirm } = req.body;
  const pwdError = password !== confirm ? 'Les mots de passe ne correspondent pas.' : passwordPolicyError(password);
  if (pwdError) errors.password = pwdError;
  if (Object.keys(errors).length) {
    return signupView(res, { values: v, errors, formError: 'Le formulaire contient des erreurs, vérifiez les champs signalés.' }, 400);
  }
  const user = await accounts.signup(v, password);
  await audit(req, 'signup_requested', { targetType: 'user', targetId: user && user.id, actor: v.email });
  res.render('auth/signup-done', { title: 'Vérifiez votre boîte mail', email: v.email });
});

router.get('/inscription/confirmer/:token', async (req, res) => {
  const t = await accounts.verifyEmail(req.params.token);
  if (!t) return res.status(410).render('errors/error', { title: 'Lien invalide', message: 'Ce lien de confirmation est invalide ou a expiré. Connectez-vous pour en recevoir un nouveau.' });
  await audit(req, 'signup_email_verified', { targetType: 'user', targetId: t.user_id, actor: t.full_name });
  res.render('errors/info', {
    title: 'Adresse confirmée',
    message: 'Merci. Votre demande de compte organisateur est maintenant transmise à la FFSA pour validation. Vous recevrez un e-mail dès qu’elle sera acceptée.',
  });
});

router.post('/deconnexion', async (req, res) => {
  if (req.user) await audit(req, 'logout');
  req.session.destroy(() => {
    res.clearCookie('ffsa.sid');
    res.redirect('/connexion');
  });
});

// ---- Mot de passe oublié / invitation ----

router.get('/mot-de-passe-oublie', (req, res) => res.render('auth/forgot', { title: 'Mot de passe oublié', sent: false }));

router.post('/mot-de-passe-oublie', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await db.one('SELECT id FROM users WHERE email = $1 AND active', [email]);
  if (user) {
    const token = randomToken();
    await db.query(
      `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'reset', $2, now() + interval '1 hour')`,
      [user.id, hashToken(token)],
    );
    await mailer.send('passwordReset', email, { link: `${config.baseUrl}/mot-de-passe/${token}` });
    await audit(req, 'password_reset_requested', { targetType: 'user', targetId: user.id, actor: email });
  }
  // Réponse identique que le compte existe ou non
  res.render('auth/forgot', { title: 'Mot de passe oublié', sent: true });
});

async function findUserToken(token) {
  return db.one(
    `SELECT t.id, t.user_id, t.purpose, u.email FROM user_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.active`,
    [hashToken(token)],
  );
}

router.get('/mot-de-passe/:token', async (req, res) => {
  const t = await findUserToken(req.params.token);
  if (!t) return res.status(410).render('errors/error', { title: 'Lien invalide', message: 'Ce lien est invalide ou a expiré.' });
  res.render('auth/set-password', { title: 'Définir le mot de passe', error: null, email: t.email });
});

router.post('/mot-de-passe/:token', async (req, res) => {
  const t = await findUserToken(req.params.token);
  if (!t) return res.status(410).render('errors/error', { title: 'Lien invalide', message: 'Ce lien est invalide ou a expiré.' });
  const { password, confirm } = req.body;
  const error = password !== confirm ? 'Les mots de passe ne correspondent pas.' : passwordPolicyError(password);
  if (error) return res.status(400).render('auth/set-password', { title: 'Définir le mot de passe', error, email: t.email });
  await db.tx(async (client) => {
    await client.query('UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1', [t.user_id, await hashPassword(password)]);
    await client.query('UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [t.user_id]);
  });
  await audit(req, t.purpose === 'invite' ? 'account_activated' : 'password_reset', { targetType: 'user', targetId: t.user_id, actor: t.email });
  res.render('errors/info', { title: 'Mot de passe enregistré', message: 'Vous pouvez maintenant vous connecter.', link: '/connexion', linkLabel: 'Se connecter' });
});

// ---- Activation de la double authentification ----

router.get('/compte/2fa', requireLogin, async (req, res) => {
  if (req.user.totp_enabled) {
    return res.render('account/totp-enabled', { title: 'Double authentification' });
  }
  if (!req.session.pendingTotp) req.session.pendingTotp = totp.generateSecret();
  const secret = req.session.pendingTotp;
  const qr = await QRCode.toDataURL(totp.otpauthUrl(secret, req.user.email));
  res.render('account/totp-setup', { title: 'Activer la double authentification', qr, secret, error: null });
});

router.post('/compte/2fa', requireLogin, async (req, res) => {
  const secret = req.session.pendingTotp;
  if (!secret) return res.redirect('/compte/2fa');
  if (!totp.verify(secret, req.body.code)) {
    const qr = await QRCode.toDataURL(totp.otpauthUrl(secret, req.user.email));
    return res.status(400).render('account/totp-setup', { title: 'Activer la double authentification', qr, secret, error: 'Code incorrect, réessayez.' });
  }
  await db.query('UPDATE users SET totp_secret_enc = $2, totp_enabled = true WHERE id = $1', [req.user.id, encrypt(secret)]);
  delete req.session.pendingTotp;
  await audit(req, 'totp_enabled', { targetType: 'user', targetId: req.user.id });
  res.redirect(homeFor(req.user));
});

module.exports = router;
