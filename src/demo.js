'use strict';

// Mode démonstration : jamais activé sur l'instance de production HDS.
const express = require('express');
const db = require('./db');
const config = require('./config');
const totp = require('./lib/totp');
const mailer = require('./lib/mailer');
const reports = require('./services/reports');
const { hashPassword } = require('./lib/password');
const { encrypt, decryptText } = require('./lib/crypto');

const PASSWORD = 'Demo-FFSA-2026!';
const ACCOUNTS = [
  { email: 'organisateur@demo.ffsa.fr', full_name: 'Organisateur Démo', role: 'organizer', label: 'Organisateur', organization: 'ASA Démo (exemple)' },
  { email: 'medical@demo.ffsa.fr', full_name: 'Service médical Démo', role: 'medical', label: 'Service médical', totp: true },
  { email: 'admin@demo.ffsa.fr', full_name: 'Administrateur Démo', role: 'admin', label: 'Administrateur (sans accès aux données de santé)', totp: true },
];

async function seed() {
  const hash = await hashPassword(PASSWORD);
  for (const a of ACCOUNTS) {
    const exists = await db.one('SELECT id FROM users WHERE email = $1', [a.email]);
    if (exists) continue;
    await db.query(
      'INSERT INTO users (email, full_name, role, password_hash, totp_enabled, totp_secret_enc, organization) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [a.email, a.full_name, a.role, hash, Boolean(a.totp), a.totp ? encrypt(totp.generateSecret()) : null, a.organization || null],
    );
  }
  const { rows } = await db.query('SELECT count(*)::int AS n FROM accident_reports');
  if (rows[0].n > 0) return;

  // Deux dossiers d'exemple : un complet, un en attente du médecin
  const orga = await db.one('SELECT * FROM users WHERE email = $1', [ACCOUNTS[0].email]);
  const base = {
    doctor_first_name: 'Claire', doctor_last_name: 'Moreau', doctor_email: 'dr.moreau@demo.ffsa.fr', doctor_phone: '06 12 34 56 78',
    author_first_name: 'Jean', author_last_name: 'Martin', author_role: 'Directeur de course',
  };
  const done = await reports.createAccidentReport(orga, {
    ...base,
    event_name: 'Rallye des Vosges (exemple)', event_location: 'Gérardmer', discipline: 'Rallye', event_level: 'Épreuve nationale',
    event_date: '2026-09-20', accident_date: '2026-09-20', accident_time: '14:35',
    summary_victim_last_name: 'Exemple', summary_victim_first_name: 'Paul', circumstances: 'Sortie de route en ES3, tonneau. Pilote extrait par l’équipe d’intervention.',
    hospitalised_count: 1, deaths_count: 0, casualties: { Pilotes: { 'Nombre de blessés': 1 } },
    vehicle1_driver_role: 'Pilote', vehicle1_driver_last_name: 'Exemple', vehicle1_driver_first_name: 'Paul', vehicle1_number: '27', vehicle1_license: '254781', vehicle1_vehicle_type: 'Voiture de tourisme (y compris SUV et 4x4)',
    weather: ['Nuageux'], surface: ['Asphalte'], track_condition: ['Mouillé'],
  }, {});
  await reports.createAccidentReport(orga, {
    ...base,
    event_name: 'Course de côte du Mont-Dore (exemple)', event_location: 'Le Mont-Dore', discipline: 'Course de côte',
    event_date: '2026-09-27', accident_date: '2026-09-27', accident_time: '10:05',
    summary_victim_last_name: 'Exemple', summary_victim_first_name: 'Léa', vehicle1_driver_role: 'Pilote', vehicle1_driver_last_name: 'Exemple', vehicle1_driver_first_name: 'Léa', vehicle1_number: '112', vehicle1_license: '287654', circumstances: 'Choc latéral contre le rail au virage 7.',
  }, {});
  const request = await db.one(
    `SELECT mr.*, ar.reference, ar.event_name FROM medical_requests mr JOIN accident_reports ar ON ar.id = mr.accident_id
      WHERE ar.id = $1 AND mr.revoked_at IS NULL`,
    [done.id],
  );
  await reports.addMedicalReport(request, {
    patient_last_name: 'Exemple', patient_first_name: 'Paul', patient_type: ['Pilote'], bp: '130/80', pulse: '92', glasgow: '15',
    upper_limbs: { Clavicule: { Droite: 'F' } }, spine: ['Cervical'], decision: ['Évacuation non urgente', 'Imagerie'],
    hospital: 'CHU de Nancy', diagnosis: 'Fracture de la clavicule droite suspectée.',
    classification: "2 : transfert à l'hôpital", unfit: 'Non (pas de suspension de licence)', current_event: 'Inapte à reprendre',
    doctor_name: 'Claire Moreau',
  }, {});
  await reports.finishMedical(request);
  mailer.outbox.length = 0; // la boîte de démo commence vide
}

// Comptes de démo et code 2FA courant, affichés sur la page de connexion
async function accountsForDisplay() {
  const out = [];
  for (const a of ACCOUNTS) {
    const u = await db.one('SELECT totp_enabled, totp_secret_enc FROM users WHERE email = $1', [a.email]);
    out.push({ ...a, password: PASSWORD, hasTotp: Boolean(u && u.totp_enabled) });
  }
  return out;
}

async function currentCode(userId) {
  const u = await db.one('SELECT totp_secret_enc FROM users WHERE id = $1', [userId]);
  return u && u.totp_secret_enc ? totp.generate(decryptText(u.totp_secret_enc)) : null;
}

const router = express.Router();
router.get('/demo/emails', (req, res) => {
  const strip = (t) => t.split(config.baseUrl).join('');
  const mails = [...mailer.outbox].reverse().map((m) => ({ ...m, to: [].concat(m.to).join(', '), text: strip(m.text) }));
  res.render('demo/emails', { title: 'E-mails de démonstration', mails });
});

module.exports = { seed, accountsForDisplay, currentCode, router, PASSWORD };
