'use strict';

const db = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { encrypt, decrypt, encryptJson, decryptJson, decryptText, randomToken, hashToken, randomDigits } = require('../lib/crypto');
const accidentForm = require('../forms/accident');
const medicalForm = require('../forms/medical');

const DAY = 24 * 3600 * 1000;
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const frDate = (d) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
const backOfficeLink = (id) => `${config.baseUrl}/back-office/dossiers/${id}`;

async function nextReference(client) {
  const { rows } = await client.query("SELECT nextval('accident_reference_seq') AS n");
  return `ACC-${new Date().getFullYear()}-${String(rows[0].n).padStart(5, '0')}`;
}

async function insertAttachments(client, accidentId, source, files) {
  for (const [field, list] of Object.entries(files || {})) {
    for (const f of list) {
      await client.query(
        `INSERT INTO attachments (accident_id, source, field, filename_enc, mime_type, size_bytes, content_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [accidentId, source, field, encrypt(f.originalname), f.mimetype, f.size, encrypt(f.buffer)],
      );
    }
  }
}

// Crée la demande de rapport médical et renvoie le jeton en clair (à envoyer par e-mail)
async function createMedicalRequest(client, accidentId, doctorEmail) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.doctorLinkValidityDays * DAY);
  await client.query(
    `UPDATE medical_requests SET revoked_at = now() WHERE accident_id = $1 AND revoked_at IS NULL AND used_at IS NULL`,
    [accidentId],
  );
  const { rows } = await client.query(
    `INSERT INTO medical_requests (accident_id, doctor_email_enc, token_hash, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [accidentId, encrypt(doctorEmail), hashToken(token), expiresAt],
  );
  return { id: rows[0].id, token, expiresAt };
}

async function sendDoctorInvitation(request, { reference, eventName, doctorEmail }) {
  await mailer.send('doctorInvitation', doctorEmail, {
    reference,
    eventName,
    link: `${config.baseUrl}/medecin/${request.token}`,
    expiresAt: frDate(request.expiresAt),
  });
  await db.query('UPDATE medical_requests SET sent_at = now() WHERE id = $1', [request.id]);
}

async function createAccidentReport(organizer, values, files) {
  const { report, request } = await db.tx(async (client) => {
    const reference = await nextReference(client);
    const { rows } = await client.query(
      `INSERT INTO accident_reports (reference, organizer_id, event_name, event_date, discipline, data_enc, form_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, reference, event_name`,
      [reference, organizer.id, values.event_name, values.event_date || null, values.discipline || null, encryptJson(values), accidentForm.version],
    );
    const report = rows[0];
    await insertAttachments(client, report.id, 'accident', files);
    const request = await createMedicalRequest(client, report.id, values.doctor_email);
    return { report, request };
  });

  const ctx = { reference: report.reference, eventName: report.event_name };
  await sendDoctorInvitation(request, { ...ctx, doctorEmail: values.doctor_email });
  await mailer.send('organizerConfirmation', organizer.email, ctx);
  await mailer.send('serviceNewAccident', config.medicalServiceEmails, { ...ctx, link: backOfficeLink(report.id) });
  return report;
}

async function getAccident(id) {
  const row = await db.one('SELECT * FROM accident_reports WHERE id = $1', [id]);
  if (!row) return null;
  return { ...row, data: decryptJson(row.data_enc) };
}

// Rapports médicaux du dossier (un par patient consulté)
async function listMedical(accidentId) {
  const { rows } = await db.query('SELECT * FROM medical_reports WHERE accident_id = $1 ORDER BY created_at', [accidentId]);
  return rows.map((r) => ({ ...r, data: decryptJson(r.data_enc) }));
}

async function listAttachments(accidentId) {
  const { rows } = await db.query(
    'SELECT id, source, field, filename_enc, mime_type, size_bytes, created_at FROM attachments WHERE accident_id = $1 ORDER BY created_at',
    [accidentId],
  );
  return rows.map((r) => ({ ...r, filename: decryptText(r.filename_enc) }));
}

async function getAttachment(accidentId, attachmentId) {
  const row = await db.one('SELECT * FROM attachments WHERE id = $1 AND accident_id = $2', [attachmentId, accidentId]);
  if (!row) return null;
  return { ...row, filename: decryptText(row.filename_enc), content: decrypt(row.content_enc) };
}

async function listRequests(accidentId) {
  const { rows } = await db.query(
    'SELECT id, doctor_email_enc, expires_at, sent_at, reminder_sent_at, revoked_at, used_at, created_at FROM medical_requests WHERE accident_id = $1 ORDER BY created_at DESC',
    [accidentId],
  );
  return rows.map((r) => ({ ...r, doctorEmail: decryptText(r.doctor_email_enc) }));
}

// ---- Accès médecin par lien sécurisé ----

async function findRequestByToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const req = await db.one(
    `SELECT mr.*, ar.reference, ar.event_name, ar.status
       FROM medical_requests mr JOIN accident_reports ar ON ar.id = mr.accident_id
      WHERE mr.token_hash = $1`,
    [hashToken(token)],
  );
  if (!req) return null;
  let state = 'valid';
  if (req.used_at || req.status === 'complete') state = 'used';
  else if (req.revoked_at) state = 'revoked';
  else if (new Date(req.expires_at) < new Date()) state = 'expired';
  return { ...req, state, doctorEmail: decryptText(req.doctor_email_enc) };
}

async function sendDoctorOtp(request) {
  const code = randomDigits(6);
  await db.query(
    `UPDATE medical_requests SET otp_hash = $2, otp_expires_at = now() + interval '${OTP_MINUTES} minutes', otp_attempts = 0 WHERE id = $1`,
    [request.id, hashToken(`${request.id}:${code}`)],
  );
  await mailer.send('doctorOtp', request.doctorEmail, { reference: request.reference, code });
}

async function verifyDoctorOtp(request, code) {
  const row = await db.one(
    `UPDATE medical_requests SET otp_attempts = otp_attempts + 1 WHERE id = $1
     RETURNING otp_hash, otp_expires_at, otp_attempts`,
    [request.id],
  );
  if (!row.otp_hash || row.otp_attempts > OTP_MAX_ATTEMPTS || new Date(row.otp_expires_at) < new Date()) return false;
  const ok = row.otp_hash === hashToken(`${request.id}:${String(code || '').trim()}`);
  if (ok) await db.query('UPDATE medical_requests SET otp_hash = NULL WHERE id = $1', [request.id]);
  return ok;
}

// Ajoute le rapport d'un patient ; le dossier reste ouvert jusqu'à sa clôture par le médecin
async function addMedicalReport(request, values, files) {
  return db.tx(async (client) => {
    const { rows } = await client.query('SELECT used_at, revoked_at FROM medical_requests WHERE id = $1 FOR UPDATE', [request.id]);
    if (!rows[0] || rows[0].used_at || rows[0].revoked_at) return null;
    const { rows: created } = await client.query(
      `INSERT INTO medical_reports (accident_id, request_id, data_enc, form_version) VALUES ($1, $2, $3, $4) RETURNING id`,
      [request.accident_id, request.id, encryptJson(values), medicalForm.version],
    );
    await insertAttachments(client, request.accident_id, 'medical', files);
    return created[0].id;
  });
}

// Le médecin indique avoir transmis tous ses rapports : le dossier est complet
async function finishMedical(request) {
  const done = await db.tx(async (client) => {
    const { rows } = await client.query('SELECT used_at, revoked_at FROM medical_requests WHERE id = $1 FOR UPDATE', [request.id]);
    if (!rows[0] || rows[0].used_at || rows[0].revoked_at) return false;
    const { rows: count } = await client.query('SELECT count(*)::int AS n FROM medical_reports WHERE accident_id = $1', [request.accident_id]);
    if (!count[0].n) return false;
    await client.query('UPDATE medical_requests SET used_at = now() WHERE accident_id = $1 AND used_at IS NULL', [request.accident_id]);
    await client.query("UPDATE accident_reports SET status = 'complete', completed_at = now() WHERE id = $1", [request.accident_id]);
    return true;
  });
  if (done) {
    await mailer.send('serviceComplete', config.medicalServiceEmails, {
      reference: request.reference,
      eventName: request.event_name,
      link: backOfficeLink(request.accident_id),
    });
  }
  return done;
}

// Renvoi (éventuellement à une nouvelle adresse) depuis le back office
async function resendInvitation(accidentId, doctorEmail) {
  const accident = await db.one('SELECT id, reference, event_name, status FROM accident_reports WHERE id = $1', [accidentId]);
  if (!accident || accident.status === 'complete') return false;
  const request = await db.tx((client) => createMedicalRequest(client, accidentId, doctorEmail));
  await sendDoctorInvitation(request, { reference: accident.reference, eventName: accident.event_name, doctorEmail });
  return true;
}

// Relance automatique des médecins n'ayant pas répondu
async function sendReminders() {
  const { rows } = await db.query(
    `SELECT mr.id, mr.accident_id, mr.doctor_email_enc, ar.reference, ar.event_name
       FROM medical_requests mr JOIN accident_reports ar ON ar.id = mr.accident_id
      WHERE mr.used_at IS NULL AND mr.revoked_at IS NULL AND mr.reminder_sent_at IS NULL
        AND mr.expires_at > now() AND mr.sent_at < now() - make_interval(hours => $1)
        AND NOT EXISTS (SELECT 1 FROM medical_reports r WHERE r.accident_id = mr.accident_id)`,
    [config.doctorReminderHours],
  );
  for (const r of rows) {
    // Le jeton d'origine n'étant pas conservé, un nouveau lien est émis
    const request = await db.tx(async (client) => {
      const created = await createMedicalRequest(client, r.accident_id, decryptText(r.doctor_email_enc));
      await client.query('UPDATE medical_requests SET reminder_sent_at = now(), sent_at = now() WHERE id = $1', [created.id]);
      return created;
    });
    await mailer.send('doctorReminder', decryptText(r.doctor_email_enc), {
      reference: r.reference,
      eventName: r.event_name,
      link: `${config.baseUrl}/medecin/${request.token}`,
    });
  }
  return rows.length;
}

module.exports = {
  createAccidentReport,
  getAccident,
  listMedical,
  listAttachments,
  getAttachment,
  listRequests,
  findRequestByToken,
  sendDoctorOtp,
  verifyDoctorOtp,
  addMedicalReport,
  finishMedical,
  resendInvitation,
  sendReminders,
};
