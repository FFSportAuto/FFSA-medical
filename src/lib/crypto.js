'use strict';

const crypto = require('crypto');
const config = require('../config');

// Format : [version 1 octet][iv 12 octets][tag 16 octets][données chiffrées]
const VERSION = 1;
const key = Buffer.from(config.encryptionKey, 'base64');
if (key.length !== 32) {
  throw new Error('DATA_ENCRYPTION_KEY doit faire 32 octets encodés en base64');
}

function encrypt(plain) {
  const buf = Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), 'utf8');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
}

function decrypt(blob) {
  if (!blob || blob[0] !== VERSION) throw new Error('Format de données chiffrées inconnu');
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
}

const encryptJson = (obj) => encrypt(JSON.stringify(obj));
const decryptJson = (blob) => JSON.parse(decrypt(blob).toString('utf8'));
const decryptText = (blob) => decrypt(blob).toString('utf8');

// Jeton aléatoire (envoyé par e-mail) ; seule son empreinte est stockée en base
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const randomDigits = (n = 6) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  decryptText,
  randomToken,
  hashToken,
  randomDigits,
  safeEqual,
};
