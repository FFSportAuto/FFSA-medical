'use strict';

const db = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const sms = require('../lib/sms');
const { encrypt, decrypt, encryptJson, decryptJson, decryptText, randomToken, hashToken, randomDigits } = require('../lib/crypto');
const accidentForm = require('../forms/accident');
const medicalForm = require('../forms/medical');

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const frDate = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).replace(' ', ' à ');
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

// Crée la demande de rapport médical et renvoie le jeton en clair (à envoyer par e-mail et SMS)
async function createMedicalRequest(client, accidentId, doctorEmail, doctorPhone, transferredFrom = null) {
  const token = randomToken();
  // Le lien du médecin est valable 48 h ; ensuite, seul le service médical peut en renvoyer un
  const expiresAt = new Date(Date.now() + config.doctorLinkValidityHours * 3600 * 1000);
  await client.query(
    `UPDATE medical_requests SET revoked_at = now() WHERE accident_id = $1 AND revoked_at IS NULL AND used_at IS NULL`,
    [accidentId],
  );
  const { rows } = await client.query(
    `INSERT INTO medical_requests (accident_id, doctor_email_enc, doctor_phone_enc, token_hash, expires_at, transferred_from)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [accidentId, encrypt(doctorEmail), doctorPhone ? encrypt(doctorPhone) : null, hashToken(token), expiresAt, transferredFrom],
  );
  return { id: rows[0].id, token, expiresAt, doctorPhone };
}

async function sendDoctorInvitation(request, { reference, eventName, doctorEmail }, template = 'doctorInvitation') {
  const link = `${config.baseUrl}/medecin/${request.token}`;
  await mailer.send(template, doctorEmail, { reference, eventName, link, expiresAt: frDate(request.expiresAt) });
  await sms.send(template, request.doctorPhone, { reference, link });
  await db.query('UPDATE medical_requests SET sent_at = now() WHERE id = $1', [request.id]);
}

// Le rapport médical n'est demandé que si le médecin de l'épreuve a examiné les personnes accidentées
const needsMedical = (values) => values.doctor_examined !== 'Non';

async function createAccidentReport(organizer, values, files) {
  const withMedical = needsMedical(values);
  const { report, request } = await db.tx(async (client) => {
    const reference = await nextReference(client);
    // La colonne event_date porte la date de l'accident (liste, tri et filtres du back office)
    const { rows } = await client.query(
      `INSERT INTO accident_reports (reference, organizer_id, event_name, event_date, discipline, data_enc, form_version, status, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, reference, event_name`,
      [reference, organizer.id, values.event_name, values.accident_date || values.event_date || null, values.discipline || null, encryptJson(values),
        accidentForm.version, withMedical ? 'awaiting_medical' : 'no_medical', withMedical ? null : new Date()],
    );
    const report = rows[0];
    await insertAttachments(client, report.id, 'accident', files);
    const request = withMedical ? await createMedicalRequest(client, report.id, values.doctor_email, values.doctor_phone) : null;
    return { report, request };
  });

  const ctx = { reference: report.reference, eventName: report.event_name };
  if (request) await sendDoctorInvitation(request, { ...ctx, doctorEmail: values.doctor_email });
  await mailer.send('organizerConfirmation', organizer.email, { ...ctx, withMedical });
  await mailer.send('serviceNewAccident', config.medicalServiceEmails, { ...ctx, withMedical, link: backOfficeLink(report.id) });
  return report;
}

async function getAccident(id) {
  const row = await db.one('SELECT * FROM accident_reports WHERE id = $1', [id]);
  if (!row) return null;
  return { ...row, data: decryptJson(row.data_enc) };
}

const dec = (b) => (b ? decryptText(b) : null);

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
    `SELECT id, doctor_email_enc, doctor_phone_enc, expires_at, sent_at, reminder_sent_at, revoked_at, used_at, transferred_from, created_at
       FROM medical_requests WHERE accident_id = $1 ORDER BY created_at DESC`,
    [accidentId],
  );
  return rows.map((r) => ({ ...r, doctorEmail: decryptText(r.doctor_email_enc), doctorPhone: dec(r.doctor_phone_enc) }));
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
  return { ...req, state, doctorEmail: decryptText(req.doctor_email_enc), doctorPhone: dec(req.doctor_phone_enc) };
}

async function sendDoctorOtp(request) {
  const code = randomDigits(6);
  await db.query(
    `UPDATE medical_requests SET otp_hash = $2, otp_expires_at = now() + interval '${OTP_MINUTES} minutes', otp_attempts = 0 WHERE id = $1`,
    [request.id, hashToken(`${request.id}:${code}`)],
  );
  await mailer.send('doctorOtp', request.doctorEmail, { reference: request.reference, code });
  await sms.send('doctorOtp', request.doctorPhone, { reference: request.reference, code });
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
async function addMedicalReport(request, values, files, patientRef = null) {
  return db.tx(async (client) => {
    const { rows } = await client.query('SELECT used_at, revoked_at FROM medical_requests WHERE id = $1 FOR UPDATE', [request.id]);
    if (!rows[0] || rows[0].used_at || rows[0].revoked_at) return null;
    const { rows: created } = await client.query(
      `INSERT INTO medical_reports (accident_id, request_id, data_enc, form_version, patient_ref) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [request.accident_id, request.id, encryptJson(values), medicalForm.version, patientRef],
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

// Renvoi (éventuellement à d'autres coordonnées) depuis le back office ; sans portable fourni,
// on reprend le dernier connu
async function resendInvitation(accidentId, doctorEmail, doctorPhone) {
  const accident = await db.one('SELECT id, reference, event_name, status FROM accident_reports WHERE id = $1', [accidentId]);
  if (!accident || accident.status !== 'awaiting_medical') return false;
  if (!doctorPhone) {
    const last = await db.one('SELECT doctor_phone_enc FROM medical_requests WHERE accident_id = $1 ORDER BY created_at DESC LIMIT 1', [accidentId]);
    doctorPhone = last ? dec(last.doctor_phone_enc) : null;
  }
  const request = await db.tx((client) => createMedicalRequest(client, accidentId, doctorEmail, doctorPhone));
  await sendDoctorInvitation(request, { reference: accident.reference, eventName: accident.event_name, doctorEmail });
  return true;
}

// ---- Durée de conservation ----

const retentionEnd = (createdAt) => {
  const d = new Date(createdAt);
  d.setFullYear(d.getFullYear() + config.retentionYears);
  return d;
};

// Suppression définitive des dossiers arrivés au terme de la durée de conservation
// (rapports médicaux, pièces jointes, demandes, notes : suppression en cascade)
async function purgeExpired() {
  const { rows } = await db.query(
    `DELETE FROM accident_reports WHERE created_at < now() - make_interval(years => $1) RETURNING reference`,
    [config.retentionYears],
  );
  if (rows.length) {
    await require('../lib/audit')(null, 'retention_purge', {
      actor: 'système (durée de conservation)',
      details: { count: rows.length, references: rows.map((r) => r.reference) },
    });
  }
  return rows.length;
}

// ---- Brouillons (enregistrement automatique) ----

const DRAFT_DAYS = 30;
async function saveDraft(key, values) {
  await db.query(
    `INSERT INTO drafts (owner_key, data_enc, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (owner_key) DO UPDATE SET data_enc = EXCLUDED.data_enc, updated_at = now()`,
    [key, encryptJson(values)],
  );
}
async function getDraft(key) {
  const row = await db.one(`SELECT data_enc, updated_at FROM drafts WHERE owner_key = $1 AND updated_at > now() - interval '${DRAFT_DAYS} days'`, [key]);
  return row ? { values: decryptJson(row.data_enc), updatedAt: row.updated_at } : null;
}
const deleteDraft = (key) => db.query('DELETE FROM drafts WHERE owner_key = $1', [key]);
const purgeDrafts = () => db.query(`DELETE FROM drafts WHERE updated_at < now() - interval '${DRAFT_DAYS} days'`);

// ---- Suivi des dossiers (service médical) ----

const PROCESSING = { a_analyser: 'À analyser', en_cours: 'En cours', clos: 'Clos' };
const OVERDUE_HOURS = 48;

async function updateCase(accidentId, { status, assignedTo }) {
  const sets = [];
  const params = [accidentId];
  if (status !== undefined) {
    if (!PROCESSING[status]) throw new Error('Statut inconnu');
    params.push(status);
    sets.push(`processing_status = $${params.length}`);
  }
  if (assignedTo !== undefined) {
    params.push(assignedTo || null);
    sets.push(`assigned_to = $${params.length}`);
  }
  if (!sets.length) return;
  await db.query(`UPDATE accident_reports SET ${sets.join(', ')} WHERE id = $1`, params);
}

async function addNote(accidentId, userId, body) {
  await db.query('INSERT INTO case_notes (accident_id, user_id, body_enc) VALUES ($1, $2, $3)', [accidentId, userId, encrypt(body)]);
}

async function listNotes(accidentId) {
  const { rows } = await db.query(
    `SELECT n.id, n.body_enc, n.created_at, u.full_name AS author
       FROM case_notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.accident_id = $1 ORDER BY n.created_at`,
    [accidentId],
  );
  return rows.map((r) => ({ id: r.id, author: r.author, created_at: r.created_at, body: decryptText(r.body_enc) }));
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
  saveDraft,
  retentionEnd,
  purgeExpired,
  getDraft,
  deleteDraft,
  purgeDrafts,
  updateCase,
  addNote,
  listNotes,
  PROCESSING,
  OVERDUE_HOURS,
};
