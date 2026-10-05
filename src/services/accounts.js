'use strict';

// Comptes organisateurs autonomes : inscription libre (validée par la FFSA) et comptes licenciés (SSO).
const db = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { hashPassword } = require('../lib/password');
const { randomToken, hashToken } = require('../lib/crypto');

const { JOB_TITLES, validateSignup } = require('./signup-rules');

async function createToken(userId, purpose, hours) {
  const token = randomToken();
  await db.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [userId, purpose, hashToken(token), hours],
  );
  return token;
}

// Inscription libre : compte en attente de confirmation de l'e-mail puis de validation par la FFSA.
// Réponse identique que l'adresse soit déjà connue ou non (pas de divulgation des comptes existants).
async function signup(v, password) {
  const existing = await db.one('SELECT id FROM users WHERE email = $1', [v.email]);
  if (existing) {
    await mailer.send('signupExisting', v.email, { link: `${config.baseUrl}/mot-de-passe-oublie` });
    return null;
  }
  const user = await db.one(
    `INSERT INTO users (email, full_name, role, password_hash, auth_source, phone, organization, job_title, license_number, signup_message, approval_status)
     VALUES ($1, $2, 'organizer', $3, 'local', $4, $5, $6, $7, $8, 'pending') RETURNING id, email, full_name`,
    [v.email, `${v.first_name} ${v.last_name}`, await hashPassword(password), v.phone, v.organization, v.job_title, v.license_number || null, v.message || null],
  );
  const token = await createToken(user.id, 'verify', 48);
  await mailer.send('signupVerify', user.email, { name: user.full_name, link: `${config.baseUrl}/inscription/confirmer/${token}` });
  return user;
}

async function verifyEmail(token) {
  const t = await db.one(
    `SELECT t.id, t.user_id, u.full_name, u.organization, u.email_verified_at FROM user_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = 'verify' AND t.used_at IS NULL AND t.expires_at > now()`,
    [hashToken(token)],
  );
  if (!t) return null;
  await db.tx(async (client) => {
    await client.query('UPDATE user_tokens SET used_at = now() WHERE id = $1', [t.id]);
    await client.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [t.user_id]);
  });
  await mailer.send('signupToReview', config.approverEmails, {
    name: t.full_name, organization: t.organization || '—', link: `${config.baseUrl}/back-office/demandes`,
  });
  return t;
}

async function listRequests() {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.organization, u.job_title, u.license_number, u.signup_message,
            u.approval_status, u.created_at, u.email_verified_at, u.reviewed_at, u.review_note, r.full_name AS reviewer
       FROM users u LEFT JOIN users r ON r.id = u.reviewed_by
      WHERE u.auth_source = 'local' AND u.role = 'organizer' AND (u.approval_status <> 'approved' OR u.reviewed_at IS NOT NULL)
      ORDER BY (u.approval_status = 'pending') DESC, u.created_at DESC LIMIT 300`,
  );
  return rows;
}

const pendingCount = async () =>
  Number((await db.one("SELECT count(*) AS n FROM users WHERE approval_status = 'pending' AND email_verified_at IS NOT NULL")).n);

async function review(userId, reviewer, decision, note) {
  const status = decision === 'valider' ? 'approved' : 'rejected';
  const user = await db.one(
    `UPDATE users SET approval_status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
      WHERE id = $1 AND role = 'organizer' AND approval_status = 'pending' RETURNING id, email, full_name`,
    [userId, status, reviewer.id, note || null],
  );
  if (!user) return null;
  if (status === 'approved') await mailer.send('signupApproved', user.email, { name: user.full_name, link: `${config.baseUrl}/connexion` });
  else await mailer.send('signupRejected', user.email, { name: user.full_name, reason: note });
  return { ...user, status };
}

// Première connexion par compte licencié : rattachement à un compte existant (même e-mail vérifié) ou création.
async function findOrCreateSsoUser(identity) {
  let user = await db.one('SELECT * FROM users WHERE sso_subject = $1', [identity.subject]);
  if (user) {
    user = await db.one(
      'UPDATE users SET license_number = COALESCE($2, license_number), organization = COALESCE($3, organization) WHERE id = $1 RETURNING *',
      [user.id, identity.license, identity.organization],
    );
    return { user, created: false };
  }
  if (identity.email && identity.emailVerified) {
    user = await db.one('SELECT * FROM users WHERE email = $1', [identity.email]);
    // Les comptes du back office ne sont jamais rattachés automatiquement : mot de passe + 2FA obligatoires
    if (user && user.role !== 'organizer') {
      const err = new Error('Compte du back office');
      err.code = 'STAFF_ACCOUNT';
      throw err;
    }
    if (user) {
      user = await db.one(
        `UPDATE users SET sso_subject = $2, license_number = COALESCE($3, license_number), organization = COALESCE($4, organization),
                email_verified_at = COALESCE(email_verified_at, now()),
                approval_status = CASE WHEN approval_status = 'pending' THEN 'approved' ELSE approval_status END
          WHERE id = $1 RETURNING *`,
        [user.id, identity.subject, identity.license, identity.organization],
      );
      return { user, created: false, linked: true };
    }
  }
  if (!identity.email) throw new Error('Le compte licencié ne fournit pas d’adresse e-mail.');
  user = await db.one(
    `INSERT INTO users (email, full_name, role, auth_source, sso_subject, license_number, organization, email_verified_at, approval_status)
     VALUES ($1, $2, 'organizer', 'sso', $3, $4, $5, now(), 'approved') RETURNING *`,
    [identity.email, identity.fullName || identity.email, identity.subject, identity.license, identity.organization],
  );
  return { user, created: true };
}

module.exports = { JOB_TITLES, validateSignup, signup, verifyEmail, listRequests, pendingCount, review, findOrCreateSsoUser, createToken };
