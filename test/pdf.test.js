'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildDossierPdf } = require('../src/lib/pdf');
const fixture = require('./fixtures/dossier-exemple');

for (const kind of ['accident', 'medical', 'complet']) {
  test(`PDF ${kind} généré au format du modèle FFSA`, async () => {
    const pdf = await buildDossierPdf(kind, fixture);
    assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert.ok(pages >= (kind === 'medical' ? 2 : 5), `${pages} pages`);
  });
}

test('PDF médical sans rapport : page explicative', async () => {
  const pdf = await buildDossierPdf('medical', { accident: fixture.accident, medicalReports: [] });
  assert.strictEqual(pdf.subarray(0, 5).toString(), '%PDF-');
});
