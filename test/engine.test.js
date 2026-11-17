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
  assert.ok(errors.accident_date);
  assert.ok(errors.doctor_examined);
  assert.ok(!errors.doctor_email, 'coordonnées du médecin demandées seulement s\'il a examiné les personnes');
  assert.ok(engine.validate(accidentForm, { doctor_examined: 'Oui' }).errors.doctor_email);
  assert.ok(!engine.validate(accidentForm, { doctor_examined: 'Non' }).errors.doctor_email);
  assert.ok(!errors.discipline_other, 'champ conditionnel masqué non exigé');
  assert.ok(!engine.validate(accidentForm, { discipline: 'Autre' }).errors.discipline_other, 'facultatif');

  const m = engine.validate(medicalForm, {});
  assert.ok(m.errors.classification);
  assert.ok(m.errors.patient_last_name);
});

test('rédacteur identifié par sa licence, confirmation des témoins, formulaires en étapes', () => {
  assert.strictEqual(engine.validate(accidentForm, {}).errors.author_license, 'Champ obligatoire.');
  const { values, errors } = engine.validate(accidentForm, { author_license: '201501', witness1_confirmed: '1' });
  assert.strictEqual(errors.author_license, undefined);
  assert.strictEqual(values.witness1_confirmed, true);
  assert.ok(!engine.allFields(accidentForm).some((f) => f.name === 'author_certified'));
  assert.ok(!engine.allFields(accidentForm).some((f) => f.type === 'signature'));
  // Chaque section appartient à une étape, et les étapes se suivent sans se mélanger
  for (const form of [accidentForm, medicalForm]) {
    const steps = form.sections.map((s) => s.step);
    assert.ok(steps.every(Boolean), form.id);
    const order = steps.filter((s, i) => s !== steps[i - 1]);
    assert.strictEqual(new Set(order).size, order.length, form.id);
  }
});

test('les valeurs des champs masqués sont ignorées', () => {
  const { values } = engine.validate(medicalForm, {
    fit: 'Non (suspension de licence)',
    current_event: 'Apte à reprendre',
  });
  assert.strictEqual(values.current_event, undefined);
  const r = engine.validate(medicalForm, { fit: 'Oui (pas de suspension de licence)', current_event: 'Apte à reprendre' });
  assert.strictEqual(r.values.current_event, 'Apte à reprendre');
});

test('matrices', () => {
  const upper = medicalForm.sections.flatMap((s) => s.fields).find((f) => f.name === 'upper_limbs');
  const casualties = accidentForm.sections.flatMap((s) => s.fields).find((f) => f.name === 'casualties');
  const m = engine.validate(medicalForm, { [engine.cellName(upper, 0, 1)]: 'Fracture', [engine.cellName(upper, 5, 0)]: 'Plaie' });
  assert.deepStrictEqual(m.values.upper_limbs, { Clavicule: { Gauche: 'Fracture' }, 'Main / Doigts': { Droite: 'Plaie' } });
  assert.ok(engine.validate(medicalForm, { [engine.cellName(upper, 0, 0)]: 'F' }).errors.upper_limbs);

  // Équipement : un tableau par concurrent (Présent Oui / Non / NSP, détail seulement si Oui) ;
  // le tableau d'un concurrent non déclaré est ignoré
  const all = accidentForm.sections.flatMap((s) => s.fields);
  const eq1 = all.find((f) => f.name === 'equipment1');
  const eq2 = all.find((f) => f.name === 'equipment2');
  const casque = eq1.rows.indexOf('Casque');
  const e = engine.validate(accidentForm, {
    vehicle1_driver_last_name: 'Durand',
    [engine.cellName(eq1, casque, 0)]: 'Oui', [engine.cellName(eq1, casque, 1)]: 'Stilo ST5',
    [engine.cellName(eq1, 0, 0)]: 'Non', [engine.cellName(eq1, 0, 1)]: 'ignoré car Non',
    [engine.cellName(eq2, casque, 0)]: 'Oui',
  });
  assert.deepStrictEqual(e.values.equipment1, { 'Combinaison du pilote / copilote': { Présent: 'Non' }, Casque: { Présent: 'Oui', "Marque, modèle, n° d'homologation": 'Stilo ST5' } });
  assert.strictEqual(e.values.equipment2, undefined);
  assert.ok(engine.validate(accidentForm, { [engine.cellName(eq1, casque, 0)]: 'Peut-être' }).errors.equipment1);
  assert.strictEqual(eq1.displayLabel({ vehicle1_driver_first_name: 'Thomas', vehicle1_driver_last_name: 'Durand', vehicle1_number: '27' }), 'Concurrent n° 27 – Thomas Durand');
  assert.strictEqual(eq1.displayLabel({ vehicle1_driver_last_name: 'Durand' }), 'Concurrent 1 (n° non renseigné) – Durand');
  assert.strictEqual(eq1.rows.length, 19);

  const a = engine.validate(accidentForm, { [engine.cellName(casualties, 0, 0)]: '2' });
  assert.deepStrictEqual(a.values.casualties, { Pilotes: { 'Nombre de blessés': 2 } });
  assert.ok(engine.validate(accidentForm, { [engine.cellName(casualties, 0, 0)]: '-1' }).errors.casualties);

  const cols = engine.exportColumns(medicalForm);
  const col = cols.find((c) => c.label === 'Membres supérieurs – Clavicule – Gauche');
  assert.strictEqual(col.value(m.values), 'Fracture');
});

test('validation des formats', () => {
  const { errors } = engine.validate(accidentForm, {
    doctor_email: 'pas-un-email',
    doctor_examined: 'Oui',
    accident_date: '2026-13-45',
    discipline: 'Inconnue',
    weather: 'Piratage',
  });
  assert.ok(errors.doctor_email);
  assert.ok(errors.accident_date);
  assert.ok(errors.discipline);
  assert.ok(errors.weather);
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

test('pilotes / copilotes : identité puis sous-partie « Véhicule », listes du tableur FFSA 2027', () => {
  const fields = accidentForm.sections.find((s) => s.title === 'Pilote / copilote accidenté').fields;
  assert.deepStrictEqual(fields.map((f) => f.label), [
    'Concurrent n°', 'Licence n°', 'Prénom du pilote / copilote', 'Nom du pilote / copilote',
    'Véhicule',
    'Type de véhicule', 'Spécification du véhicule', 'Marque', 'Modèle', 'Année de construction', 'Groupe',
    'Catégorie (karting)', "Si c'est un Dragster, catégorie",
    'Caractéristiques techniques',
    'Habitacle', 'Position du poste de conduite', 'Type de moteur', 'Type de carburant',
    'Enregistreur de données accident (ADR)',
    "Véhicule équipé d'un ADR émis par la FIA ?", 'N° de série / référence ADR', 'Données récupérées',
  ]);
  assert.deepStrictEqual(fields.filter((f) => f.type === 'heading').map((f) => f.label), ['Véhicule', 'Caractéristiques techniques', 'Enregistreur de données accident (ADR)']);
  const lists = Object.fromEntries(fields.filter((f) => f.type === 'select').map((f) => [f.name.replace('vehicle1_', ''), f.options]));
  assert.deepStrictEqual(lists, {
    vehicle_type: ['Monoplace', 'Kart', 'Voiture de tourisme (y compris SUV et 4x4)', 'GT', 'Voiture de sport deux places', 'Prototype Le Mans (LMP)', 'Silhouette', 'Camion', 'Buggy', 'Dragster', 'Autre'],
    adr: ['Inconnu', 'Non', 'Oui'],
    adr_data: ['Oui', 'Non'],
    cockpit: ['Ouvert', 'Fermé'],
    driving_position: ['Centrale', 'Gauche', 'Droite'],
    engine_type: ['Moteur thermique', 'Hybride', 'Electrique', 'Autre'],
    fuel_type: ['Essence', 'Diesel', 'Gaz', 'Methanol', 'Essence/hybride', 'Diesel/hybride', 'Electrique', 'Autre'],
    specification: ['Inconnue', 'Moderne (Annexe J)', 'Historique (Annexe K)', 'Autre'],
  });
  assert.ok(fields.filter((f) => f.type === 'select').every((f) => f.dropdown), 'affichées en listes déroulantes');
  // Référence et données ADR demandées seulement si le véhicule est équipé d'un ADR
  const v = engine.validate(accidentForm, { vehicle1_adr: 'Non', vehicle1_adr_reference: 'X', vehicle1_adr_data: 'Oui' }).values;
  assert.strictEqual(v.vehicle1_adr_reference, undefined);
  assert.strictEqual(v.vehicle1_adr_data, undefined);
  const w = engine.validate(accidentForm, { vehicle1_adr: 'Oui', vehicle1_adr_reference: 'X', vehicle1_adr_data: 'Non' }).values;
  assert.strictEqual(w.vehicle1_adr_reference, 'X');
  assert.strictEqual(w.vehicle1_adr_data, 'Non');
  // Catégorie karting seulement pour un kart
  assert.strictEqual(engine.validate(accidentForm, { vehicle1_vehicle_type: 'GT', vehicle1_kart_category: 'OK' }).values.vehicle1_kart_category, undefined);
  assert.strictEqual(engine.validate(accidentForm, { vehicle1_vehicle_type: 'Kart', vehicle1_kart_category: 'OK' }).values.vehicle1_kart_category, 'OK');
  assert.ok(engine.validate(accidentForm, { vehicle1_fuel_type: 'Kérosène' }).errors.vehicle1_fuel_type);
});

test('autres personnes, conditions et témoins : retours du 17/11', () => {
  // Licencié : licence et fonction ; non licencié : coordonnées
  const lic = engine.validate(accidentForm, { person1_licensed: 'Oui', person1_license: '1', person1_function: 'Volontaire', person1_email: 'x@y.fr' }).values;
  assert.strictEqual(lic.person1_license, '1');
  assert.strictEqual(lic.person1_email, undefined);
  const non = engine.validate(accidentForm, { person1_licensed: 'Non', person1_license: '1', person1_email: 'x@y.fr', person1_address: 'Rue' }).values;
  assert.strictEqual(non.person1_license, undefined);
  assert.deepStrictEqual([non.person1_email, non.person1_address], ['x@y.fr', 'Rue']);
  const fn = accidentForm.sections.flatMap((s) => s.fields).find((f) => f.name === 'person1_function');
  assert.deepStrictEqual(fn.options, ['Directeur de Course', 'Commissaire Sportif', 'Commissaire de Route / de Piste', 'Volontaire', 'Autre']);
  // Météo et revêtement : choix unique
  for (const name of ['weather', 'visibility', 'surface', 'track_layout', 'track_condition']) {
    assert.strictEqual(accidentForm.sections.flatMap((s) => s.fields).find((f) => f.name === name).type, 'radio', name);
  }
  // Témoin : contact facultatif ; circonstances en texte libre
  const w = engine.validate(accidentForm, { witness1_email: 't@exemple.fr', witness1_phone: '0601020304', circumstances: 'Sortie de route' }).values;
  assert.deepStrictEqual([w.witness1_email, w.witness1_phone, w.circumstances], ['t@exemple.fr', '0601020304', 'Sortie de route']);
  // Plus d'étape « L'accident » ni de date de l'épreuve
  assert.ok(!accidentForm.sections.some((s) => s.step === "L'accident"));
  assert.ok(!engine.allFields(accidentForm).some((f) => f.name === 'event_date' || f.name.startsWith('summary_')));
  // Contact joignable le lundi matin : dans l'épreuve, avant le médecin
  const names = engine.allFields(accidentForm).map((f) => f.name);
  const mc = ['monday_contact_last_name', 'monday_contact_first_name', 'monday_contact_email', 'monday_contact_phone'];
  assert.ok(mc.every((n) => names.indexOf(n) > names.indexOf('casualties') && names.indexOf(n) < names.indexOf('doctor_examined')));
  const c = engine.validate(accidentForm, { monday_contact_last_name: 'Laurent', monday_contact_email: 'pas-un-mail', monday_contact_phone: '06 21 43 65 87' });
  assert.ok(c.errors.monday_contact_email);
  assert.strictEqual(c.values.monday_contact_phone, '06 21 43 65 87');
});

test('personnes déclarées reprises dans le rapport médical (sans doublon)', () => {
  const { declaredPersons } = require('../src/forms/patients');
  const list = declaredPersons({
    vehicle1_driver_last_name: 'Girard', vehicle1_driver_first_name: 'Thomas', vehicle1_number: '27', vehicle1_group: 'GT4', vehicle1_license: '254781',
    person1_last_name: 'Bernard', person1_first_name: 'Julien', person1_licensed: 'Oui', person1_license: '301122', person1_function: 'Commissaire de Route / de Piste',
    person2_last_name: 'Roux', person2_first_name: 'Anne', person2_licensed: 'Non', person2_phone: '06 55 44 33 22', person2_address: '12 rue des Lilas',
    person3_last_name: 'girard', person3_first_name: 'Thomas',
  });
  assert.strictEqual(list.length, 3, 'la même personne déclarée deux fois n\'apparaît qu\'une fois');
  assert.deepStrictEqual(list[0].prefill, {
    patient_last_name: 'Girard', patient_first_name: 'Thomas', crew_number: '27', category: 'GT4', license: '254781',
  });
  assert.deepStrictEqual(list[1].prefill.patient_type, ['Officiel']);
  assert.strictEqual(list[1].prefill.license, '301122');
  assert.deepStrictEqual([list[2].detail, list[2].prefill.phone, list[2].prefill.address], ['Non licencié(e)', '06 55 44 33 22', '12 rue des Lilas']);
});
