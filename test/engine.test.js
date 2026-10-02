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
  assert.ok(!engine.validate(accidentForm, { discipline: 'Autre' }).errors.discipline_other, 'facultatif');

  const m = engine.validate(medicalForm, {});
  assert.ok(m.errors.classification);
  assert.ok(m.errors.patient_last_name);
});

test('les valeurs des champs masqués sont ignorées', () => {
  const { values } = engine.validate(medicalForm, {
    unfit: 'Oui (suspension de licence)',
    current_event: 'Apte à reprendre',
  });
  assert.strictEqual(values.current_event, undefined);
  const r = engine.validate(medicalForm, { unfit: 'Non (pas de suspension de licence)', current_event: 'Apte à reprendre' });
  assert.strictEqual(r.values.current_event, 'Apte à reprendre');
});

test('matrices', () => {
  const upper = medicalForm.sections.flatMap((s) => s.fields).find((f) => f.name === 'upper_limbs');
  const casualties = accidentForm.sections.flatMap((s) => s.fields).find((f) => f.name === 'casualties');
  const m = engine.validate(medicalForm, { [engine.cellName(upper, 0, 1)]: 'F', [engine.cellName(upper, 5, 0)]: 'P' });
  assert.deepStrictEqual(m.values.upper_limbs, { Clavicule: { Gauche: 'F' }, 'Main / Doigts': { Droite: 'P' } });
  assert.ok(engine.validate(medicalForm, { [engine.cellName(upper, 0, 0)]: 'Z' }).errors.upper_limbs);

  const a = engine.validate(accidentForm, { [engine.cellName(casualties, 0, 0)]: '2' });
  assert.deepStrictEqual(a.values.casualties, { Pilotes: { 'Nombre de blessés': 2 } });
  assert.ok(engine.validate(accidentForm, { [engine.cellName(casualties, 0, 0)]: '-1' }).errors.casualties);

  const cols = engine.exportColumns(medicalForm);
  const col = cols.find((c) => c.label === 'Membres supérieurs – Clavicule – Gauche');
  assert.strictEqual(col.value(m.values), 'F');
});

test('validation des formats', () => {
  const { errors } = engine.validate(accidentForm, {
    doctor_email: 'pas-un-email',
    event_date: '2026-13-45',
    discipline: 'Inconnue',
    weather: ['Nuageux', 'Piratage'],
    deaths_count: '-3',
  });
  assert.ok(errors.doctor_email);
  assert.ok(errors.event_date);
  assert.ok(errors.discipline);
  assert.ok(errors.weather);
  assert.ok(errors.deaths_count);
});

test('pré-remplissage du rapport médical', () => {
  const v = engine.prefill(medicalForm, { event_name: 'Rallye X', accident_date: '2026-09-20', doctor_first_name: 'Marie', doctor_last_name: 'Durand' });
  assert.strictEqual(v.event, 'Rallye X');
  assert.strictEqual(v.date, '2026-09-20');
  assert.strictEqual(v.doctor_name, 'Marie Durand');
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
