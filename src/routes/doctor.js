'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const audit = require('../lib/audit');
const engine = require('../forms/engine');
const medicalForm = require('../forms/medical');
const accidentForm = require('../forms/accident');
const reports = require('../services/reports');
const { uploadFields } = require('../middleware/upload');

const router = express.Router();
const ACCESS_MINUTES = 60;
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

// Champs de la déclaration d'accident communiqués au médecin pour contexte
const CONTEXT_FIELDS = [
  'event_name', 'event_date', 'accident_time', 'event_location', 'discipline',
  'victim_role', 'victim_last_name', 'victim_first_name', 'victim_birthdate', 'victim_sex',
  'accident_place', 'accident_type', 'description', 'evacuation', 'hospital_name',
];

const STATE_MESSAGES = {
  used: 'Le rapport médical de ce dossier a déjà été transmis. Merci.',
  revoked: 'Ce lien a été remplacé par un lien plus récent. Utilisez le dernier e-mail reçu.',
  expired: 'Ce lien a expiré. Contactez le service médical de la FFSA pour en obtenir un nouveau.',
};

const maskEmail = (email) => email.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + '•'.repeat(Math.min(b.length, 6)) + c);

// Résout la demande à partir du jeton ; interrompt si elle n'est plus valide
async function loadRequest(req, res, next) {
  const request = await reports.findRequestByToken(req.params.token);
  if (!request) {
    return res.status(404).render('errors/error', { title: 'Lien invalide', message: "Ce lien n'est pas valide." });
  }
  if (request.state !== 'valid') {
    return res.status(410).render('errors/info', { title: 'Rapport médical', message: STATE_MESSAGES[request.state] });
  }
  req.medicalRequest = request;
  const access = req.session.doctorAccess;
  req.doctorVerified = Boolean(access && access.requestId === request.id && access.until > Date.now());
  res.locals.token = req.params.token;
  next();
}

function contextFor(accident) {
  const values = Object.fromEntries(CONTEXT_FIELDS.map((k) => [k, accident.data[k]]));
  return engine.toDisplay(accidentForm, values);
}

async function renderForm(req, res, { values, errors = {}, formError = null, status = 200 }) {
  const accident = await reports.getAccident(req.medicalRequest.accident_id);
  res.status(status).render('doctor/form', {
    title: `${medicalForm.title} – ${accident.reference}`,
    form: medicalForm,
    accident,
    context: contextFor(accident),
    values,
    errors,
    formError,
  });
}

router.get('/medecin/:token', loadRequest, async (req, res) => {
  const request = req.medicalRequest;
  if (!req.doctorVerified) {
    return res.render('doctor/verify', {
      title: 'Vérification',
      reference: request.reference,
      maskedEmail: maskEmail(request.doctorEmail),
      codeSent: false,
      error: null,
    });
  }
  const accident = await reports.getAccident(request.accident_id);
  // Pré-remplissage à partir des coordonnées saisies par l'organisateur
  const values = {};
  for (const f of engine.allFields(medicalForm)) if (f.prefill) values[f.name] = accident.data[f.prefill] || '';
  await renderForm(req, res, { values });
});

router.post('/medecin/:token/code', codeLimiter, loadRequest, async (req, res) => {
  await reports.sendDoctorOtp(req.medicalRequest);
  await audit(req, 'doctor_otp_sent', { targetType: 'accident', targetId: req.medicalRequest.accident_id, actor: 'médecin (lien)' });
  res.render('doctor/verify', {
    title: 'Vérification',
    reference: req.medicalRequest.reference,
    maskedEmail: maskEmail(req.medicalRequest.doctorEmail),
    codeSent: true,
    error: null,
  });
});

router.post('/medecin/:token/verifier', codeLimiter, loadRequest, async (req, res) => {
  const request = req.medicalRequest;
  if (!(await reports.verifyDoctorOtp(request, req.body.code))) {
    await audit(req, 'doctor_otp_failed', { targetType: 'accident', targetId: request.accident_id, actor: 'médecin (lien)' });
    return res.status(401).render('doctor/verify', {
      title: 'Vérification',
      reference: request.reference,
      maskedEmail: maskEmail(request.doctorEmail),
      codeSent: true,
      error: 'Code incorrect ou expiré.',
    });
  }
  req.session.doctorAccess = { requestId: request.id, until: Date.now() + ACCESS_MINUTES * 60 * 1000 };
  await audit(req, 'doctor_access_granted', { targetType: 'accident', targetId: request.accident_id, actor: `médecin ${request.doctorEmail}` });
  res.redirect(`/medecin/${req.params.token}`);
});

router.post('/medecin/:token', ...uploadFields(medicalForm), loadRequest, async (req, res) => {
  if (!req.doctorVerified) return res.redirect(`/medecin/${req.params.token}`);
  const request = req.medicalRequest;
  const { values, errors, raw } = engine.validate(medicalForm, req.body, req.files);
  if (req.uploadError || Object.keys(errors).length) {
    return renderForm(req, res, {
      values: raw,
      errors,
      formError: req.uploadError || 'Le formulaire contient des erreurs, vérifiez les champs signalés.',
      status: 400,
    });
  }
  const ok = await reports.submitMedicalReport(request, values, req.files);
  if (!ok) return res.status(409).render('errors/info', { title: 'Rapport médical', message: STATE_MESSAGES.used });
  await audit(req, 'medical_submitted', { targetType: 'accident', targetId: request.accident_id, actor: `médecin ${request.doctorEmail}` });
  delete req.session.doctorAccess;
  res.render('errors/info', {
    title: 'Rapport médical transmis',
    message: `Merci, le rapport médical du dossier ${request.reference} a été transmis au service médical de la FFSA.`,
  });
});

module.exports = router;
