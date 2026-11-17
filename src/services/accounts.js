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

// Inscription libre : le compte devient actif dès que l'adresse e-mail est confirmée.
// Réponse identique que l'adresse soit déjà connue ou non (pas de divulgation des comptes existants).
async function signup(v, password) {
  const existing = await db.one('SELECT id FROM users WHERE email = $1', [v.email]);
  if (existing) {
    await mailer.send('signupExisting', v.email, { link: `${config.baseUrl}/mot-de-passe-oublie` });
    return null;
  }
  const user = await db.one(
    `INSERT INTO users (email, full_name, role, password_hash, auth_source, phone, job_title, license_number, approval_status)
     VALUES ($1, $2, 'organizer', $3, 'local', $4, $5, $6, 'pending') RETURNING id, email, full_name`,
    [v.email, `${v.first_name} ${v.last_name}`, await hashPassword(password), v.phone, v.job_title, v.license_number || null],
  );
  const token = await createToken(user.id, 'verify', 48);
  await mailer.send('signupVerify', user.email, { name: user.full_name, link: `${config.baseUrl}/inscription/confirmer/${token}` });
  return user;
}

async function verifyEmail(token) {
  const t = await db.one(
    `SELECT t.id, t.user_id, u.full_name, u.email_verified_at FROM user_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.purpose = 'verify' AND t.used_at IS NULL AND t.expires_at > now()`,
    [hashToken(token)],
  );
  if (!t) return null;
  await db.tx(async (client) => {
    await client.query('UPDATE user_tokens SET used_at = now() WHERE id = $1', [t.id]);
    await client.query("UPDATE users SET email_verified_at = now(), approval_status = 'approved' WHERE id = $1", [t.user_id]);
  });
  return t;
}

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

module.exports = { JOB_TITLES, validateSignup, signup, verifyEmail, findOrCreateSsoUser, createToken };
