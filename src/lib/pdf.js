'use strict';

// Génération des PDF « rapport d'accident » et « rapport médical » sur le modèle
// de l'export Jotform FFSA : en-tête logo + date, titres centrés bleu marine,
// rubriques soulignées, filets bleus entre les blocs répétés, pied de page FFSA.

const path = require('path');
const PDFDocument = require('pdfkit');
const engine = require('../forms/engine');
const accidentForm = require('../forms/accident');
const medicalForm = require('../forms/medical');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'pdf');
const FONT = {
  regular: path.join(ASSETS, 'Roboto-Regular.woff'),
  medium: path.join(ASSETS, 'Roboto-Medium.woff'),
  bold: path.join(ASSETS, 'Roboto-Bold.woff'),
};
const COLOR = { navy: '#1f2d5c', text: '#1a2233', label: '#5b6475', rule: '#4a90d9', line: '#e4e6ee', head: '#f1f4f9', muted: '#8a90a6' };

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { left: 56, right: 56, top: 118, bottom: 96 };
const CONTENT_W = PAGE.width - MARGIN.left - MARGIN.right;
const LABEL_W = 190;

const frDateTime = (d) =>
  new Date(d)
    .toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .replace(' à ', ' ');

// ---------- Mise en page de base ----------

function createDoc({ title, reference, date }) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: MARGIN,
    bufferPages: true,
    info: { Title: title, Author: 'FFSA – Service médical', Subject: reference, Creator: 'FFSA Médical' },
  });
  doc.registerFont('regular', FONT.regular);
  doc.registerFont('medium', FONT.medium);
  doc.registerFont('bold', FONT.bold);
  doc._meta = { reference, date };
  return doc;
}

function drawChrome(doc) {
  const { reference, date } = doc._meta;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keepTop = doc.page.margins.top;
    const keepBottom = doc.page.margins.bottom;
    doc.page.margins.top = 0;
    doc.page.margins.bottom = 0;
    doc.image(path.join(ASSETS, 'entete-ffsa.png'), MARGIN.left - 6, 38, { width: 150 });
    doc.font('regular').fontSize(10).fillColor(COLOR.navy)
      .text(frDateTime(date), MARGIN.left, 46, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.font('regular').fontSize(8).fillColor(COLOR.muted)
      .text(`Dossier ${reference}`, MARGIN.left, 60, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.image(path.join(ASSETS, 'pied-ffsa.jpg'), 30, PAGE.height - 82, { width: PAGE.width - 60 });
    doc.font('regular').fontSize(9).fillColor(COLOR.text)
      .text(String(i + 1), MARGIN.left, PAGE.height - 34, { width: CONTENT_W + 30, align: 'right', lineBreak: false });
    doc.page.margins.top = keepTop;
    doc.page.margins.bottom = keepBottom;
  }
}

const bottomLimit = (doc) => PAGE.height - MARGIN.bottom;
function ensureSpace(doc, h) {
  if (doc.y + h > bottomLimit(doc)) doc.addPage();
}

function pageTitle(doc, text, subtitle) {
  doc.font('bold').fontSize(17).fillColor(COLOR.navy)
    .text(text.toUpperCase(), MARGIN.left, doc.y, { width: CONTENT_W, align: 'center' });
  if (subtitle) {
    doc.moveDown(0.2).font('medium').fontSize(10.5).fillColor(COLOR.label)
      .text(subtitle, { width: CONTENT_W, align: 'center' });
  }
  doc.moveDown(1.2);
}

function blockHeading(doc, text, { align = 'center' } = {}) {
  ensureSpace(doc, 50);
  doc.moveDown(0.6);
  doc.font('bold').fontSize(11.5).fillColor(COLOR.navy)
    .text(text.toUpperCase(), MARGIN.left, doc.y, { width: CONTENT_W, align, underline: align === 'center' });
  doc.moveDown(0.6);
}

function subHeading(doc, text) {
  ensureSpace(doc, 40);
  doc.moveDown(0.5);
  doc.font('bold').fontSize(10).fillColor(COLOR.navy).text(text.toUpperCase(), MARGIN.left, doc.y, { width: CONTENT_W });
  doc.moveDown(0.35);
}

// Filet bleu centré, comme entre les blocs répétés du modèle
function blueRule(doc) {
  ensureSpace(doc, 20);
  const w = 290;
  const x = MARGIN.left + (CONTENT_W - w) / 2;
  doc.moveDown(0.3);
  doc.save().lineWidth(2.6).strokeColor(COLOR.rule).moveTo(x, doc.y).lineTo(x + w, doc.y).stroke().restore();
  doc.moveDown(0.9);
}

function emptyNote(doc, text = 'Non renseigné') {
  doc.font('regular').fontSize(9.5).fillColor(COLOR.muted).text(text, MARGIN.left, doc.y, { width: CONTENT_W, align: 'center' });
  doc.moveDown(0.4);
}

function row(doc, label, value) {
  const valueX = MARGIN.left + LABEL_W;
  const valueW = CONTENT_W - LABEL_W;
  doc.font('medium').fontSize(9);
  const hl = doc.heightOfString(label, { width: LABEL_W - 12 });
  doc.font('regular').fontSize(10);
  const hv = doc.heightOfString(value, { width: valueW });
  const h = Math.max(hl, hv) + 9;
  ensureSpace(doc, h);
  const y = doc.y;
  doc.font('medium').fontSize(9).fillColor(COLOR.label).text(label, MARGIN.left, y + 4, { width: LABEL_W - 12 });
  doc.font('regular').fontSize(10).fillColor(COLOR.text).text(value, valueX, y + 3.5, { width: valueW });
  doc.save().lineWidth(0.5).strokeColor(COLOR.line).moveTo(MARGIN.left, y + h).lineTo(MARGIN.left + CONTENT_W, y + h).stroke().restore();
  doc.x = MARGIN.left;
  doc.y = y + h;
}

function signatureRow(doc, label, dataUrl) {
  const h = 62;
  ensureSpace(doc, h + 6);
  const y = doc.y;
  doc.font('medium').fontSize(9).fillColor(COLOR.label).text(label, MARGIN.left, y + 4, { width: LABEL_W - 12 });
  try {
    const buf = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
    doc.image(buf, MARGIN.left + LABEL_W, y + 4, { fit: [170, 52] });
  } catch (e) {
    doc.font('regular').fontSize(10).fillColor(COLOR.muted).text('Signature illisible', MARGIN.left + LABEL_W, y + 4);
  }
  doc.save().lineWidth(0.5).strokeColor(COLOR.line).moveTo(MARGIN.left, y + h).lineTo(MARGIN.left + CONTENT_W, y + h).stroke().restore();
  doc.x = MARGIN.left;
  doc.y = y + h;
}

function matrixTable(doc, field, value) {
  const rows = field.rows.filter((r) => value[r]);
  const firstW = Math.min(170, CONTENT_W * 0.36);
  const colW = (CONTENT_W - firstW) / field.columns.length;
  const rowH = 19;
  ensureSpace(doc, 24 + rowH * (rows.length + 1));
  doc.moveDown(0.3);
  doc.font('medium').fontSize(9).fillColor(COLOR.label).text(field.label, MARGIN.left, doc.y, { width: CONTENT_W });
  doc.moveDown(0.25);
  const startY = doc.y;
  let y = startY;
  const drawRow = (cells, header) => {
    if (header) doc.save().rect(MARGIN.left, y, CONTENT_W, rowH).fill(COLOR.head).restore();
    cells.forEach((c, i) => {
      const x = i === 0 ? MARGIN.left + 6 : MARGIN.left + firstW + colW * (i - 1);
      const w = i === 0 ? firstW - 8 : colW;
      doc.font(header || i === 0 ? 'medium' : 'regular').fontSize(header ? 8.5 : 9.5).fillColor(header ? COLOR.label : COLOR.text)
        .text(String(c ?? ''), x, y + 5, { width: w, align: i === 0 ? 'left' : 'center', lineBreak: false, ellipsis: true });
    });
    doc.save().lineWidth(0.5).strokeColor(COLOR.line).moveTo(MARGIN.left, y + rowH).lineTo(MARGIN.left + CONTENT_W, y + rowH).stroke().restore();
    y += rowH;
  };
  drawRow(['', ...field.columns], true);
  rows.forEach((r) => drawRow([r, ...field.columns.map((c) => value[r][c] ?? '')]));
  doc.save().lineWidth(0.6).strokeColor(COLOR.line).rect(MARGIN.left, startY, CONTENT_W, y - startY).stroke().restore();
  doc.x = MARGIN.left;
  doc.y = y + 6;
}

const hasValue = (v) =>
  v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

// Champs d'une section, dans l'ordre, avec sous-titres ; retourne le nombre de champs écrits
function renderSection(doc, section, values) {
  let pendingHeading = null;
  let count = 0;
  for (const f of section.fields) {
    if (f.type === 'heading') {
      pendingHeading = f.label;
      continue;
    }
    if (f.type === 'file' || !engine.isVisible({ ...f, section }, values) || !hasValue(values[f.name])) continue;
    if (pendingHeading) {
      subHeading(doc, pendingHeading);
      pendingHeading = null;
    }
    if (f.type === 'matrix') matrixTable(doc, f, values[f.name]);
    else if (f.type === 'signature') signatureRow(doc, f.label, values[f.name]);
    else row(doc, f.label, engine.formatValue(f, values[f.name]));
    count++;
  }
  return count;
}

const sectionFilled = (section, values) =>
  section.fields.some((f) => f.type !== 'file' && f.type !== 'heading' && engine.isVisible({ ...f, section }, values) && hasValue(values[f.name]));

const byTitle = (form, start) => form.sections.filter((s) => s.title.startsWith(start));

// Blocs répétés (pilotes, personnes, témoins) séparés par des filets bleus
function repeatedBlock(doc, heading, sections, values) {
  blockHeading(doc, heading);
  const filled = sections.filter((s) => sectionFilled(s, values));
  blueRule(doc);
  if (!filled.length) {
    emptyNote(doc, 'Aucun');
    blueRule(doc);
    return;
  }
  filled.forEach((s) => {
    renderSection(doc, s, values);
    blueRule(doc);
  });
}

function namedBlock(doc, heading, section, values, opts) {
  blockHeading(doc, heading, opts);
  if (!renderSection(doc, section, values)) emptyNote(doc);
}

// ---------- Rapport d'accident ----------

function writeAccident(doc, accident, attachments) {
  const v = accident.data;
  const [doctorSec] = byTitle(accidentForm, "Médecin de l'épreuve");
  const [summarySec] = byTitle(accidentForm, 'Synthèse');
  const [eventSec] = byTitle(accidentForm, "L'épreuve");
  const vehicles = [...byTitle(accidentForm, 'Pilote / copilote'), ...byTitle(accidentForm, 'Autre pilote')];
  const persons = byTitle(accidentForm, 'Autre personne');
  const witnesses = [...byTitle(accidentForm, "Témoin de l'accident"), ...byTitle(accidentForm, 'Autre témoin')];
  const [weatherSec] = byTitle(accidentForm, 'Conditions météo');
  const [surfaceSec] = byTitle(accidentForm, 'Type de revêtement');
  const [equipSec] = byTitle(accidentForm, "Étude de l'équipement");
  const [rescueSec] = byTitle(accidentForm, 'Intervention des secours');
  const [authorSec] = byTitle(accidentForm, 'Rapport établi par');

  // Page 1 : médecin de l'épreuve et synthèse (« rapport à remplir en cas d'accident »)
  pageTitle(doc, "Rapport à remplir en cas d'accident", `Dossier ${accident.reference}`);
  blockHeading(doc, "Médecin de l'épreuve", { align: 'left' });
  renderSection(doc, doctorSec, v);
  blockHeading(doc, 'À remplir impérativement en cas d’accident avec blessé (évacué par ambulance) ou plus grave', { align: 'left' });
  if (!renderSection(doc, summarySec, v)) emptyNote(doc);

  // Page 2 : rapport d'accident (épreuve, bilan humain)
  doc.addPage();
  pageTitle(doc, "Rapport d'accident");
  if (!renderSection(doc, eventSec, v)) emptyNote(doc);

  // Page 3 : pilotes / copilotes et autres personnes
  doc.addPage();
  repeatedBlock(doc, 'Pilotes / copilotes accidentés', vehicles, v);
  repeatedBlock(doc, 'Autres personnes accidentées', persons, v);

  // Page 4 : météo, revêtement, équipement, secours, pièces jointes
  doc.addPage();
  namedBlock(doc, 'Conditions météo', weatherSec, v);
  namedBlock(doc, 'Type de revêtement', surfaceSec, v);
  namedBlock(doc, "Étude de l'équipement", equipSec, v);
  namedBlock(doc, 'Intervention des secours', rescueSec, v);
  if (attachments && attachments.length) {
    blockHeading(doc, 'Pièces jointes');
    const fieldLabels = Object.fromEntries(engine.allFields(accidentForm).map((f) => [f.name, f.label]));
    attachments.filter((a) => a.source === 'accident').forEach((a) => {
      row(doc, fieldLabels[a.field] || 'Fichier', `${a.filename} (${Math.max(1, Math.round(a.size_bytes / 1024))} Ko)`);
    });
  }

  // Page 5 : témoins et rédacteur
  doc.addPage();
  repeatedBlock(doc, "Témoin(s) de l'accident", witnesses, v);
  namedBlock(doc, 'Rapport établi par :', authorSec, v);
}

// ---------- Rapport(s) médical(aux) ----------

function writeMedical(doc, accident, reports, { firstPage }) {
  if (!reports.length) {
    if (!firstPage) doc.addPage();
    pageTitle(doc, "Rapport médical d'épreuve", `Dossier ${accident.reference}`);
    emptyNote(doc, 'Le médecin n’a pas encore transmis de rapport.');
    return;
  }
  reports.forEach((r, i) => {
    if (!(firstPage && i === 0)) doc.addPage();
    const name = [r.data.patient_last_name, r.data.patient_first_name].filter(Boolean).join(' ');
    pageTitle(doc, "Rapport médical d'épreuve", `Patient ${i + 1}${reports.length > 1 ? ` sur ${reports.length}` : ''} – ${name} · transmis le ${frDateTime(r.created_at)}`);
    medicalForm.sections.forEach((s) => {
      if (!sectionFilled(s, r.data)) return;
      blockHeading(doc, s.title);
      renderSection(doc, s, r.data);
    });
  });
}

// ---------- API ----------

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawChrome(doc);
    doc.end();
  });
}

/**
 * @param kind 'accident' | 'medical' | 'complet'
 */
function buildDossierPdf(kind, { accident, medicalReports = [], attachments = [] }) {
  const titles = { accident: "Rapport d'accident", medical: 'Rapport médical', complet: "Dossier d'accident complet" };
  const doc = createDoc({
    title: `${titles[kind]} – ${accident.reference}`,
    reference: accident.reference,
    date: kind === 'medical' && medicalReports[0] ? medicalReports[0].created_at : accident.created_at,
  });
  if (kind === 'accident' || kind === 'complet') writeAccident(doc, accident, attachments);
  if (kind === 'medical' || kind === 'complet') writeMedical(doc, accident, medicalReports, { firstPage: kind === 'medical' });
  return toBuffer(doc);
}

module.exports = { buildDossierPdf };
