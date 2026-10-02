'use strict';

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../src/forms/engine');
const accidentForm = require('../src/forms/accident');
const medicalForm = require('../src/forms/medical');
const totp = require('../src/lib/totp');
const { encryptJson, decryptJson } = require('../src/lib/crypto');
const { passwordPolicyError, hashPassword, verifyPassword } = require('../src/lib/password');

test('les noms de champs sont uniques dans chaque formulaire', () => {
  for (const form of [accidentForm, medicalForm]) {
    const names = engine.allFields(form).map((f) => f.name);
    assert.strictEqual(new Set(names).size, names.length, form.id);
  }
});

test('champs obligatoires et conditions', () => {
  const { errors } = engine.validate(accidentForm, {});
  assert.ok(errors.event_name);
  assert.ok(errors.doctor_email);
  assert.ok(!errors.discipline_other, 'champ conditionnel masqué non exigé');

  const r = engine.validate(accidentForm, { discipline: 'Autre' });
  assert.ok(r.errors.discipline_other, 'champ conditionnel visible exigé');
});

test('les valeurs des champs masqués sont ignorées', () => {
  const { values } = engine.validate(accidentForm, { victim_role: 'Spectateur', vehicle: 'Clio', race_number: '12' });
  assert.strictEqual(values.vehicle, undefined);
  assert.strictEqual(values.victim_role, 'Spectateur');
});

test('validation des formats', () => {
  const { errors } = engine.validate(accidentForm, {
    doctor_email: 'pas-un-email',
    event_date: '2026-13-45',
    discipline: 'Inconnue',
    accident_type: ['Sortie de route', 'Piratage'],
    estimated_speed: '9999',
  });
  assert.ok(errors.doctor_email);
  assert.ok(errors.event_date);
  assert.ok(errors.discipline);
  assert.ok(errors.accident_type);
  assert.ok(errors.estimated_speed);

  const m = engine.validate(medicalForm, { rpps: '123', blood_pressure: '12/8', gcs: '2' });
  assert.ok(m.errors.rpps);
  assert.ok(m.errors.gcs);
});

test('chiffrement AES-GCM aller-retour et intégrité', () => {
  const blob = encryptJson({ a: 'é', b: [1, 2] });
  assert.deepStrictEqual(decryptJson(blob), { a: 'é', b: [1, 2] });
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decryptJson(blob));
});

test('TOTP RFC 6238 (vecteur de test SHA1)', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.strictEqual(totp.generate(secret, 59 * 1000), '287082');
  assert.ok(totp.verify(secret, '287082', 59 * 1000));
  assert.ok(!totp.verify(secret, '000000', 59 * 1000));
});

test('mots de passe', async () => {
  assert.ok(passwordPolicyError('court'));
  assert.ok(passwordPolicyError('toutenminuscules'));
  assert.strictEqual(passwordPolicyError('Correct-Horse-42'), null);
  const h = await hashPassword('Correct-Horse-42');
  assert.ok(await verifyPassword('Correct-Horse-42', h));
  assert.ok(!(await verifyPassword('mauvais', h)));
});
