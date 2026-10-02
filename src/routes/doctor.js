'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const audit = require('../lib/audit');
const engine = require('../forms/engine');
const medicalForm = require('../forms/medical');
const accidentForm = require('../forms/accident');
const reports = require('../services/reports');
const sms = require('../lib/sms');
const { declaredPersons } = require('../forms/patients');
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
    maskedPhone: request.doctorPhone ? sms.maskPhone(request.doctorPhone) : null,
    codeSent,
    error,
  });
}

// Extraits de la déclaration d'accident utiles au médecin (sections marquées shareWithDoctor)
const contextFor = (accident) => engine.toDisplay(accidentForm, accident.data).filter((s) => s.shareWithDoctor);

const patientName = (data) => [data.patient_last_name, data.patient_first_name].filter(Boolean).join(' ');

// Personnes déclarées par l'organisateur, avec l'état de leur rapport médical
function patientsOverview(accident, medical) {
  const done = new Map(medical.filter((m) => m.patient_ref).map((m) => [m.patient_ref, m]));
  const persons = declaredPersons(accident.data).map((p) => ({ ...p, report: done.get(p.key) || null }));
  const others = medical.filter((m) => !m.patient_ref || !persons.some((p) => p.key === m.patient_ref));
  return { persons, others };
}

// Tableau de bord du médecin : personnes déclarées, rapports saisis, transfert, clôture
router.get('/medecin/:token', loadRequest, async (req, res) => {
  const request = req.medicalRequest;
  if (!req.doctorVerified) return renderVerify(res, request);
  const accident = await reports.getAccident(request.accident_id);
  const medical = await reports.listMedical(accident.id);
  const { persons, others } = patientsOverview(accident, medical);
  res.render('doctor/dossier', {
    title: `Rapport médical – ${accident.reference}`,
    accident,
    context: contextFor(accident),
    persons,
    others: others.map((m) => ({ name: patientName(m.data), classification: m.data.classification, at: m.created_at })),
    reportCount: medical.length,
    flash: req.query.ajoute ? 'Rapport enregistré.' : null,
    error: req.query.vide ? 'Ajoutez au moins un rapport patient avant de clôturer.' : req.query.transfert === 'invalide' ? 'Adresse e-mail du confrère invalide.' : null,
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

// Clé du patient : une personne déclarée (vehicle1, person2…) ou « autre » (patient non déclaré)
async function resolvePatient(req) {
  const accident = await reports.getAccident(req.medicalRequest.accident_id);
  const ref = String(req.query.p || 'autre');
  const person = declaredPersons(accident.data).find((p) => p.key === ref) || null;
  return { accident, ref: person ? person.key : 'autre', person };
}
const draftKeyFor = (accidentId, ref) => `medical:${accidentId}:${ref}`;

async function renderForm(req, res, { accident, ref, person, values, errors = {}, formError = null, status = 200, draft = null }) {
  const token = req.params.token;
  res.status(status).render('doctor/form', {
    title: `${medicalForm.title} – ${accident.reference}`,
    form: medicalForm,
    accident,
    person,
    values,
    errors,
    formError,
    action: `/medecin/${token}/patient?p=${encodeURIComponent(ref)}`,
    draftUrl: `/medecin/${token}/brouillon?p=${encodeURIComponent(ref)}`,
    discardUrl: `/medecin/${token}/brouillon/supprimer?p=${encodeURIComponent(ref)}`,
    draftSavedAt: draft ? draft.updatedAt : null,
  });
}

router.get('/medecin/:token/patient', loadRequest, requireVerified, async (req, res) => {
  const { accident, ref, person } = await resolvePatient(req);
  const draft = await reports.getDraft(draftKeyFor(accident.id, ref));
  // Brouillon s'il existe, sinon reprise de l'épreuve, du médecin et de la personne déclarée
  const values = draft ? draft.values : { ...engine.prefill(medicalForm, accident.data), ...(person ? person.prefill : {}) };
  await renderForm(req, res, { accident, ref, person, values, draft });
});

router.post('/medecin/:token/brouillon', loadRequest, requireVerified, express.json({ limit: '1mb' }), async (req, res) => {
  const { accident, ref } = await resolvePatient(req);
  const { raw } = engine.validate(medicalForm, req.body || {});
  await reports.saveDraft(draftKeyFor(accident.id, ref), raw);
  res.json({ savedAt: new Date().toISOString() });
});

router.post('/medecin/:token/brouillon/supprimer', loadRequest, requireVerified, async (req, res) => {
  const { accident, ref } = await resolvePatient(req);
  await reports.deleteDraft(draftKeyFor(accident.id, ref));
  res.redirect(`/medecin/${req.params.token}/patient?p=${encodeURIComponent(ref)}`);
});

router.post('/medecin/:token/patient', ...uploadFields(medicalForm), loadRequest, requireVerified, async (req, res) => {
  const request = req.medicalRequest;
  const { accident, ref, person } = await resolvePatient(req);
  const { values, errors, raw } = engine.validate(medicalForm, req.body, req.files);
  if (req.uploadError || Object.keys(errors).length) {
    return renderForm(req, res, {
      accident, ref, person,
      values: raw,
      errors,
      formError: req.uploadError || 'Le formulaire contient des erreurs, vérifiez les champs signalés.',
      status: 400,
    });
  }
  const id = await reports.addMedicalReport(request, values, req.files, ref === 'autre' ? null : ref);
  if (!id) return res.status(409).render('errors/info', { title: 'Rapport médical', message: STATE_MESSAGES.used });
  await reports.deleteDraft(draftKeyFor(accident.id, ref));
  await audit(req, 'medical_submitted', { targetType: 'medical_report', targetId: id, actor: `médecin ${request.doctorEmail}`, details: { accident: request.accident_id } });
  res.redirect(`/medecin/${req.params.token}?ajoute=1`);
});

// Transmission à un confrère (par exemple le médecin qui a réellement vu le patient)
router.post('/medecin/:token/transferer', loadRequest, requireVerified, async (req, res) => {
  const request = req.medicalRequest;
  const email = String(req.body.email || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect(`/medecin/${req.params.token}?transfert=invalide`);
  if (!(await reports.transferRequest(request, email, phone || null))) {
    return res.status(409).render('errors/info', { title: 'Rapport médical', message: STATE_MESSAGES.used });
  }
  await audit(req, 'doctor_transferred', { targetType: 'accident', targetId: request.accident_id, actor: `médecin ${request.doctorEmail}` });
  delete req.session.doctorAccess;
  res.render('errors/info', {
    title: 'Demande transmise',
    message: `La demande de rapport médical du dossier ${request.reference} a été transmise à ${email}. Votre lien est désormais désactivé ; les rapports déjà saisis sont conservés.`,
  });
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
