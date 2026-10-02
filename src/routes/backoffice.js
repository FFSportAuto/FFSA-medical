'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const mailer = require('../lib/mailer');
const config = require('../config');
const engine = require('../forms/engine');
const accidentForm = require('../forms/accident');
const medicalForm = require('../forms/medical');
const reports = require('../services/reports');
const { buildDossierPdf } = require('../lib/pdf');
const { decryptJson, randomToken, hashToken } = require('../lib/crypto');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use('/back-office', requireRole('medical', 'admin'));
const adminOnly = requireRole('admin');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE_SIZE = 50;
const ROLE_LABELS = { organizer: 'Organisateur', medical: 'Service médical', admin: 'Administrateur' };

// Filtres communs à la liste et à l'export
function buildFilters(q) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (q.statut === 'awaiting_medical' || q.statut === 'complete') add('ar.status = ?', q.statut);
  if (q.discipline) add('ar.discipline = ?', String(q.discipline));
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.du || '')) add('ar.event_date >= ?', q.du);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.au || '')) add('ar.event_date <= ?', q.au);
  if (q.q) add('(ar.reference ILIKE ? OR ar.event_name ILIKE ?)', `%${String(q.q).slice(0, 100)}%`);
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

router.get('/back-office', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const { where, params } = buildFilters(req.query);
  const { rows } = await db.query(
    `SELECT ar.id, ar.reference, ar.event_name, ar.event_date, ar.discipline, ar.status, ar.created_at, ar.completed_at,
            u.full_name AS organizer_name, count(*) OVER () AS total
       FROM accident_reports ar JOIN users u ON u.id = ar.organizer_id
       ${where} ORDER BY ar.created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  const stats = await db.one(
    `SELECT count(*) FILTER (WHERE status = 'awaiting_medical') AS pending,
            count(*) FILTER (WHERE status = 'complete') AS complete, count(*) AS total FROM accident_reports`,
  );
  const total = rows.length ? Number(rows[0].total) : 0;
  res.render('backoffice/index', {
    title: 'Dossiers',
    reports: rows,
    stats,
    query: req.query,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    total,
    disciplines: engine.allFields(accidentForm).find((f) => f.name === 'discipline').options,
    exportQuery: new URLSearchParams(Object.entries(req.query).filter(([k, v]) => k !== 'page' && v)).toString(),
  });
});

router.get('/back-office/dossiers/:id', async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next();
  const accident = await reports.getAccident(req.params.id);
  if (!accident) return next();
  const [medical, attachments, requests, organizer] = await Promise.all([
    reports.listMedical(accident.id),
    reports.listAttachments(accident.id),
    reports.listRequests(accident.id),
    db.one('SELECT full_name, email FROM users WHERE id = $1', [accident.organizer_id]),
  ]);
  await audit(req, 'dossier_viewed', { targetType: 'accident', targetId: accident.id });
  res.render('backoffice/show', {
    title: `Dossier ${accident.reference}`,
    accident,
    organizer,
    accidentSections: engine.toDisplay(accidentForm, accident.data),
    medicalReports: medical.map((m) => ({ ...m, sections: engine.toDisplay(medicalForm, m.data) })),
    attachments,
    requests,
    flash: req.query.relance ? 'Nouvelle invitation envoyée au médecin.' : null,
  });
});

router.get('/back-office/dossiers/:id/pieces/:attachmentId', async (req, res, next) => {
  if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.attachmentId)) return next();
  const file = await reports.getAttachment(req.params.id, req.params.attachmentId);
  if (!file) return next();
  await audit(req, 'attachment_downloaded', { targetType: 'attachment', targetId: file.id, details: { accident: req.params.id } });
  res.set({
    'Content-Type': file.mime_type,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    'Cache-Control': 'no-store',
  });
  res.send(file.content);
});

// Téléchargement PDF (modèle FFSA) : rapport d'accident, rapport(s) médical(aux) ou dossier complet
const PDF_KINDS = { accident: 'rapport-accident', medical: 'rapport-medical', complet: 'dossier-complet' };
router.get('/back-office/dossiers/:id/pdf/:kind', async (req, res, next) => {
  const { id, kind } = req.params;
  if (!UUID_RE.test(id) || !PDF_KINDS[kind]) return next();
  const accident = await reports.getAccident(id);
  if (!accident) return next();
  const [medicalReports, attachments] = await Promise.all([reports.listMedical(id), reports.listAttachments(id)]);
  const pdf = await buildDossierPdf(kind, { accident, medicalReports, attachments });
  await audit(req, 'pdf_downloaded', { targetType: 'accident', targetId: id, details: { kind } });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${accident.reference}-${PDF_KINDS[kind]}.pdf"`,
    'Cache-Control': 'no-store',
  });
  res.send(pdf);
});

router.post('/back-office/dossiers/:id/relance', async (req, res, next) => {
  if (!UUID_RE.test(req.params.id)) return next();
  const email = String(req.body.doctor_email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).render('errors/error', { title: 'Adresse invalide', message: "L'adresse e-mail du médecin est invalide." });
  }
  const ok = await reports.resendInvitation(req.params.id, email);
  if (!ok) return next();
  await audit(req, 'doctor_invitation_resent', { targetType: 'accident', targetId: req.params.id });
  res.redirect(`/back-office/dossiers/${req.params.id}?relance=1`);
});

// ---- Export CSV ----

const csvCell = (v) => {
  let s = v === undefined || v === null ? '' : String(v);
  // Neutralise l'injection de formules dans les tableurs
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

router.get('/back-office/export.csv', async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const { rows } = await db.query(
    `SELECT ar.id, ar.reference, ar.status, ar.created_at, ar.completed_at, ar.data_enc AS accident_enc, mr.data_enc AS medical_enc
       FROM accident_reports ar LEFT JOIN medical_reports mr ON mr.accident_id = ar.id
       ${where} ORDER BY ar.created_at DESC, mr.created_at`,
    params,
  );
  const aCols = engine.exportColumns(accidentForm);
  const mCols = engine.exportColumns(medicalForm);
  const header = ['Référence', 'Statut', 'Déclaré le', 'Complété le',
    ...aCols.map((c) => `Accident – ${c.label}`), ...mCols.map((c) => `Médical – ${c.label}`)];
  const lines = [header.map(csvCell).join(';')];
  for (const r of rows) {
    const a = decryptJson(r.accident_enc);
    const m = r.medical_enc ? decryptJson(r.medical_enc) : {};
    lines.push([
      r.reference,
      r.status === 'complete' ? 'Complet' : 'En attente du rapport médical',
      new Date(r.created_at).toISOString(),
      r.completed_at ? new Date(r.completed_at).toISOString() : '',
      ...aCols.map((c) => c.value(a)),
      ...mCols.map((c) => c.value(m)),
    ].map(csvCell).join(';'));
  }
  await audit(req, 'export_csv', { details: { count: rows.length, filters: req.query } });
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="ffsa-dossiers-${new Date().toISOString().slice(0, 10)}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.send('﻿' + lines.join('\r\n'));
});

// ---- Gestion des utilisateurs (administrateurs) ----

router.get('/back-office/utilisateurs', adminOnly, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, email, full_name, role, active, totp_enabled, password_hash IS NOT NULL AS activated, last_login_at, created_at FROM users ORDER BY role, full_name',
  );
  res.render('backoffice/users', { title: 'Utilisateurs', users: rows, roleLabels: ROLE_LABELS, error: null, flash: req.query.ok || null });
});

async function sendInvite(user) {
  const token = randomToken();
  await db.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'invite', $2, now() + interval '72 hours')`,
    [user.id, hashToken(token)],
  );
  await mailer.send('userInvitation', user.email, {
    name: user.full_name,
    role: ROLE_LABELS[user.role],
    link: `${config.baseUrl}/mot-de-passe/${token}`,
  });
}

router.post('/back-office/utilisateurs', adminOnly, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim();
  const role = req.body.role;
  let error = null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error = 'Adresse e-mail invalide.';
  else if (!fullName) error = 'Le nom est obligatoire.';
  else if (!ROLE_LABELS[role]) error = 'Rôle invalide.';
  else if (await db.one('SELECT 1 FROM users WHERE email = $1', [email])) error = 'Un compte existe déjà avec cette adresse.';
  if (error) {
    const { rows } = await db.query(
      'SELECT id, email, full_name, role, active, totp_enabled, password_hash IS NOT NULL AS activated, last_login_at, created_at FROM users ORDER BY role, full_name',
    );
    return res.status(400).render('backoffice/users', { title: 'Utilisateurs', users: rows, roleLabels: ROLE_LABELS, error, flash: null });
  }
  const user = await db.one(
    'INSERT INTO users (email, full_name, role) VALUES ($1, $2, $3) RETURNING id, email, full_name, role',
    [email, fullName, role],
  );
  await sendInvite(user);
  await audit(req, 'user_created', { targetType: 'user', targetId: user.id, details: { role } });
  res.redirect('/back-office/utilisateurs?ok=' + encodeURIComponent(`Invitation envoyée à ${email}`));
});

router.post('/back-office/utilisateurs/:id/:action', adminOnly, async (req, res, next) => {
  const { id, action } = req.params;
  if (!UUID_RE.test(id)) return next();
  const user = await db.one('SELECT id, email, full_name, role, active FROM users WHERE id = $1', [id]);
  if (!user) return next();
  if (user.id === req.user.id && action !== 'inviter') {
    return res.redirect('/back-office/utilisateurs?ok=' + encodeURIComponent('Action impossible sur votre propre compte.'));
  }
  let message;
  switch (action) {
    case 'activer':
      await db.query('UPDATE users SET active = NOT active WHERE id = $1', [id]);
      await db.query("DELETE FROM session WHERE (sess->>'userId') = $1", [id]);
      message = user.active ? `Compte de ${user.email} désactivé.` : `Compte de ${user.email} réactivé.`;
      break;
    case 'reinit-2fa':
      await db.query('UPDATE users SET totp_enabled = false, totp_secret_enc = NULL WHERE id = $1', [id]);
      await db.query("DELETE FROM session WHERE (sess->>'userId') = $1", [id]);
      message = `Double authentification réinitialisée pour ${user.email}.`;
      break;
    case 'inviter':
      await sendInvite(user);
      message = `Lien de (ré)initialisation envoyé à ${user.email}.`;
      break;
    default:
      return next();
  }
  await audit(req, `user_${action}`, { targetType: 'user', targetId: id });
  res.redirect('/back-office/utilisateurs?ok=' + encodeURIComponent(message));
});

router.get('/back-office/audit', adminOnly, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const { rows } = await db.query(
    `SELECT at, actor, action, target_type, target_id, ip FROM audit_log ORDER BY at DESC LIMIT 100 OFFSET ${(page - 1) * 100}`,
  );
  res.render('backoffice/audit', { title: "Journal d'audit", entries: rows, page });
});

module.exports = router;
