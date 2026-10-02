'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, n, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const hash = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    ...PARAMS,
    N: Number(n),
  });
  return crypto.timingSafeEqual(hash, expected);
}

// Politique : 12 caractères minimum, au moins 3 types de caractères
function passwordPolicyError(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'Le mot de passe doit contenir au moins 12 caractères.';
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password));
  if (classes.length < 3) {
    return 'Le mot de passe doit mélanger au moins 3 types : minuscules, majuscules, chiffres, caractères spéciaux.';
  }
  return null;
}

module.exports = { hashPassword, verifyPassword, passwordPolicyError };
