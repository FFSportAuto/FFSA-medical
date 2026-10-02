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

const STATE_MESSAGES = {
  used: 'Le dossier médical de cet accident a été clôturé et transmis au service médical de la FFSA. Merci.',
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

// Les pages suivantes exigent la vérification par code
function requireVerified(req, res, next) {
  if (!req.doctorVerified) return res.redirect(`/medecin/${req.params.token}`);
  next();
}

function renderVerify(res, request, { codeSent = false, error = null, status = 200 } = {}) {
  res.status(status).render('doctor/verify', {
    title: 'Vérification',
    reference: request.reference,
    maskedEmail: maskEmail(request.doctorEmail),
    codeSent,
    error,
  });
}

// Extraits de la déclaration d'accident utiles au médecin (sections marquées shareWithDoctor)
const contextFor = (accident) => engine.toDisplay(accidentForm, accident.data).filter((s) => s.shareWithDoctor);

const patientName = (data) => [data.patient_last_name, data.patient_first_name].filter(Boolean).join(' ');

// Tableau de bord du médecin : rapports déjà saisis, ajout d'un patient, clôture
router.get('/medecin/:token', loadRequest, async (req, res) => {
  const request = req.medicalRequest;
  if (!req.doctorVerified) return renderVerify(res, request);
  const accident = await reports.getAccident(request.accident_id);
  const medical = await reports.listMedical(accident.id);
  res.render('doctor/dossier', {
    title: `Rapport médical – ${accident.reference}`,
    accident,
    context: contextFor(accident),
    patients: medical.map((m) => ({ name: patientName(m.data), classification: m.data.classification, at: m.created_at })),
    flash: req.query.ajoute ? 'Rapport enregistré.' : null,
    error: req.query.vide ? 'Ajoutez au moins un rapport patient avant de clôturer.' : null,
  });
});

router.post('/medecin/:token/code', codeLimiter, loadRequest, async (req, res) => {
  await reports.sendDoctorOtp(req.medicalRequest);
  await audit(req, 'doctor_otp_sent', { targetType: 'accident', targetId: req.medicalRequest.accident_id, actor: 'médecin (lien)' });
  renderVerify(res, req.medicalRequest, { codeSent: true });
});

router.post('/medecin/:token/verifier', codeLimiter, loadRequest, async (req, res) => {
  const request = req.medicalRequest;
  if (!(await reports.verifyDoctorOtp(request, req.body.code))) {
    await audit(req, 'doctor_otp_failed', { targetType: 'accident', targetId: request.accident_id, actor: 'médecin (lien)' });
    return renderVerify(res, request, { codeSent: true, error: 'Code incorrect ou expiré.', status: 401 });
  }
  req.session.doctorAccess = { requestId: request.id, until: Date.now() + ACCESS_MINUTES * 60 * 1000 };
  await audit(req, 'doctor_access_granted', { targetType: 'accident', targetId: request.accident_id, actor: `médecin ${request.doctorEmail}` });
  res.redirect(`/medecin/${req.params.token}`);
});

async function renderForm(req, res, { values, errors = {}, formError = null, status = 200 }) {
  const accident = await reports.getAccident(req.medicalRequest.accident_id);
  res.status(status).render('doctor/form', {
    title: `${medicalForm.title} – ${accident.reference}`,
    form: medicalForm,
    accident,
    values,
    errors,
    formError,
  });
}

router.get('/medecin/:token/patient', loadRequest, requireVerified, async (req, res) => {
  const accident = await reports.getAccident(req.medicalRequest.accident_id);
  await renderForm(req, res, { values: engine.prefill(medicalForm, accident.data) });
});

router.post('/medecin/:token/patient', ...uploadFields(medicalForm), loadRequest, requireVerified, async (req, res) => {
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
  const id = await reports.addMedicalReport(request, values, req.files);
  if (!id) return res.status(409).render('errors/info', { title: 'Rapport médical', message: STATE_MESSAGES.used });
  await audit(req, 'medical_submitted', { targetType: 'medical_report', targetId: id, actor: `médecin ${request.doctorEmail}`, details: { accident: request.accident_id } });
  res.redirect(`/medecin/${req.params.token}?ajoute=1`);
});

router.post('/medecin/:token/cloturer', loadRequest, requireVerified, async (req, res) => {
  const request = req.medicalRequest;
  if (!(await reports.finishMedical(request))) return res.redirect(`/medecin/${req.params.token}?vide=1`);
  await audit(req, 'medical_closed', { targetType: 'accident', targetId: request.accident_id, actor: `médecin ${request.doctorEmail}` });
  delete req.session.doctorAccess;
  res.render('errors/info', {
    title: 'Rapport médical transmis',
    message: `Merci, le rapport médical du dossier ${request.reference} a été transmis au service médical de la FFSA.`,
  });
});

module.exports = router;
