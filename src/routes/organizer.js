'use strict';

const express = require('express');
const db = require('../db');
const audit = require('../lib/audit');
const engine = require('../forms/engine');
const accidentForm = require('../forms/accident');
const reports = require('../services/reports');
const { requireRole } = require('../middleware/auth');
const { uploadFields } = require('../middleware/upload');

const router = express.Router();
router.use('/organisateur', requireRole('organizer'));

router.get('/organisateur', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, reference, event_name, event_date, status, created_at, completed_at
       FROM accident_reports WHERE organizer_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [req.user.id],
  );
  res.render('organizer/index', { title: 'Mes déclarations', reports: rows, created: req.query.cree || null });
});

router.get('/organisateur/rapports/nouveau', (req, res) => {
  res.render('organizer/new', {
    title: accidentForm.title,
    form: accidentForm,
    values: { declarant_name: req.user.full_name, declarant_email: req.user.email },
    errors: {},
    formError: null,
  });
});

router.post('/organisateur/rapports', ...uploadFields(accidentForm), async (req, res) => {
  const { values, errors, raw } = engine.validate(accidentForm, req.body, req.files);
  if (req.uploadError || Object.keys(errors).length) {
    return res.status(400).render('organizer/new', {
      title: accidentForm.title,
      form: accidentForm,
      values: raw,
      errors,
      formError: req.uploadError || 'Le formulaire contient des erreurs, vérifiez les champs signalés.',
    });
  }
  const report = await reports.createAccidentReport(req.user, values, req.files);
  await audit(req, 'accident_created', { targetType: 'accident', targetId: report.id, details: { reference: report.reference } });
  res.redirect(`/organisateur?cree=${encodeURIComponent(report.reference)}`);
});

router.get('/organisateur/rapports/:id', async (req, res, next) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return next();
  const accident = await reports.getAccident(req.params.id);
  if (!accident || accident.organizer_id !== req.user.id) return next();
  await audit(req, 'accident_viewed', { targetType: 'accident', targetId: accident.id });
  // L'organisateur voit sa déclaration mais jamais le rapport médical
  res.render('organizer/show', {
    title: `Dossier ${accident.reference}`,
    accident,
    sections: engine.toDisplay(accidentForm, accident.data),
  });
});

module.exports = router;
