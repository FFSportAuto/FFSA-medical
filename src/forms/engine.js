'use strict';

// Moteur générique : validation, conditions d'affichage, mise à plat pour l'affichage et l'export.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEL_RE = /^[+()0-9.\s-]{6,25}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MAX_TEXT = 200;
const MAX_TEXTAREA = 10000;
const MAX_SIGNATURE = 300000;

const allFields = (form) => form.sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s })));

// Nom du champ HTML d'une cellule de matrice
const cellName = (field, ri, ci) => `${field.name}__${ri}__${ci}`;

function validateCell(cell, v) {
  if (cell.type === 'select') return cell.options.includes(v) ? null : 'Choix invalide.';
  if (cell.type === 'number') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n)) return 'Nombre invalide.';
    if (cell.min !== undefined && n < cell.min) return `Minimum : ${cell.min}.`;
    if (cell.max !== undefined && n > cell.max) return `Maximum : ${cell.max}.`;
    return null;
  }
  return v.length > MAX_TEXT ? `${MAX_TEXT} caractères maximum.` : null;
}

// Matrice stockée sous la forme { ligne: { colonne: valeur } } (cellules vides omises)
function readMatrix(field, body) {
  const out = {};
  let error = null;
  field.rows.forEach((row, ri) => {
    field.columns.forEach((col, ci) => {
      const raw = body[cellName(field, ri, ci)];
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v) return;
      const err = validateCell(field.cell, v);
      if (err) error = `${row} / ${col} : ${err}`;
      (out[row] = out[row] || {})[col] = field.cell.type === 'number' && !err ? Number(v.replace(',', '.')) : v;
    });
  });
  return { value: out, error };
}

function conditionMet(cond, values) {
  if (!cond) return true;
  const v = values[cond.field];
  if ('equals' in cond) return v === cond.equals;
  if ('in' in cond) return cond.in.includes(v);
  if ('includes' in cond) return Array.isArray(v) && v.includes(cond.includes);
  return true;
}

const isVisible = (field, values) =>
  conditionMet(field.section && field.section.showIf, values) && conditionMet(field.showIf, values);

const asArray = (v) => (v === undefined || v === null || v === '' ? [] : [].concat(v));

/**
 * Valide le corps de requête.
 * @param form   définition du formulaire
 * @param body   req.body
 * @param files  { [fieldName]: [multerFile] }
 * @returns { values, errors }  values ne contient que les champs visibles, nettoyés
 */
function validate(form, body, files = {}) {
  const raw = {};
  const matrixErrors = {};
  for (const f of allFields(form)) {
    if (f.type === 'heading') continue;
    if (f.type === 'matrix') {
      const { value, error } = readMatrix(f, body);
      raw[f.name] = value;
      if (error) matrixErrors[f.name] = error;
    } else if (f.type === 'checkboxes') raw[f.name] = asArray(body[f.name]).map(String);
    else if (f.type === 'consent') raw[f.name] = body[f.name] ? true : false;
    else if (f.type !== 'file') raw[f.name] = typeof body[f.name] === 'string' ? body[f.name].trim() : '';
  }

  const values = {};
  const errors = {};
  for (const f of allFields(form)) {
    if (f.type === 'heading' || !isVisible(f, raw)) continue;
    const v = raw[f.name];
    const empty =
      f.type === 'file'
        ? !(files[f.name] && files[f.name].length)
        : f.type === 'matrix'
          ? Object.keys(v).length === 0
          : Array.isArray(v)
          ? v.length === 0
          : v === '' || v === false;

    if (empty) {
      if (f.required) errors[f.name] = 'Champ obligatoire.';
      continue;
    }
    if (f.type === 'file') continue;

    let err = null;
    switch (f.type) {
      case 'text':
      case 'tel':
      case 'email':
        if (v.length > MAX_TEXT) err = `${MAX_TEXT} caractères maximum.`;
        else if (f.type === 'email' && !EMAIL_RE.test(v)) err = 'Adresse e-mail invalide.';
        else if (f.type === 'tel' && !TEL_RE.test(v)) err = 'Numéro de téléphone invalide.';
        break;
      case 'textarea':
        if (v.length > MAX_TEXTAREA) err = `${MAX_TEXTAREA} caractères maximum.`;
        break;
      case 'date':
        if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) err = 'Date invalide.';
        break;
      case 'time':
        if (!TIME_RE.test(v)) err = 'Heure invalide.';
        break;
      case 'number': {
        const n = Number(v.replace(',', '.'));
        if (!Number.isFinite(n)) err = 'Nombre invalide.';
        else if (f.min !== undefined && n < f.min) err = `Minimum : ${f.min}.`;
        else if (f.max !== undefined && n > f.max) err = `Maximum : ${f.max}.`;
        else values[f.name] = n;
        break;
      }
      case 'select':
      case 'radio':
        if (!f.options.includes(v)) err = 'Choix invalide.';
        break;
      case 'checkboxes':
        if (v.some((o) => !f.options.includes(o))) err = 'Choix invalide.';
        break;
      case 'signature':
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > MAX_SIGNATURE) err = 'Signature invalide.';
        break;
      case 'consent':
        break;
      case 'matrix':
        err = matrixErrors[f.name] || null;
        break;
      default:
        err = 'Type de champ inconnu.';
    }
    if (!err && f.pattern && !new RegExp(f.pattern).test(v)) err = f.patternMessage || 'Format invalide.';
    if (err) errors[f.name] = err;
    else if (!(f.name in values)) values[f.name] = v;
  }
  return { values, errors, raw };
}

function formatValue(field, value) {
  if (value === undefined || value === null || value === '') return '';
  if (field.type === 'matrix') {
    return Object.entries(value)
      .map(([row, cols]) => `${row} : ${Object.entries(cols).map(([c, v]) => `${c} ${v}`).join(', ')}`)
      .join(' ; ');
  }
  if (Array.isArray(value)) return value.join(', ');
  if (field.type === 'consent') return value ? 'Oui' : 'Non';
  if (field.type === 'date') {
    const [y, m, d] = String(value).split('-');
    return `${d}/${m}/${y}`;
  }
  return String(value);
}

// Sections + champs visibles avec leur valeur formatée, pour l'affichage en lecture
function toDisplay(form, values) {
  return form.sections
    .map((s) => ({
      title: s.title,
      shareWithDoctor: Boolean(s.shareWithDoctor),
      fields: s.fields
        .filter((f) => f.type !== 'file' && isVisible({ ...f, section: s }, values) && values[f.name] !== undefined)
        .map((f) => ({ ...f, value: values[f.name], display: formatValue(f, values[f.name]) })),
    }))
    .filter((s) => s.fields.length);
}

// Colonnes pour l'export CSV (hors signatures et fichiers) : { label, value(values) }
function exportColumns(form) {
  const cols = [];
  for (const f of allFields(form)) {
    if (['file', 'signature', 'heading'].includes(f.type)) continue;
    if (f.type === 'matrix') {
      for (const row of f.rows) {
        for (const col of f.columns) {
          cols.push({ label: `${f.label} – ${row} – ${col}`, value: (v) => (v[f.name] && v[f.name][row] && v[f.name][row][col]) ?? '' });
        }
      }
    } else {
      cols.push({ label: f.label, value: (v) => formatValue(f, v[f.name]) });
    }
  }
  return cols;
}

// Colonnes de l'export pseudonymisé : uniquement les champs à choix, nombres et heures.
// Exclus : textes libres (noms, adresses, récits pouvant identifier), e-mails, téléphones,
// signatures, fichiers ; les dates sont réduites au mois.
const PSEUDO_TYPES = new Set(['select', 'radio', 'checkboxes', 'number', 'time', 'date', 'matrix']);
function pseudonymizedColumns(form) {
  const cols = [];
  for (const f of allFields(form)) {
    if (!PSEUDO_TYPES.has(f.type) || (f.type === 'matrix' && f.cell.type === 'text') || f.name === 'birthdate') continue;
    if (f.type === 'matrix') {
      for (const row of f.rows) for (const col of f.columns) {
        cols.push({ label: `${f.label} – ${row} – ${col}`, value: (v) => (v[f.name] && v[f.name][row] && v[f.name][row][col]) ?? '' });
      }
    } else if (f.type === 'date') {
      cols.push({ label: `${f.label} (mois)`, value: (v) => (v[f.name] ? String(v[f.name]).slice(0, 7) : '') });
    } else {
      cols.push({ label: f.label, value: (v) => formatValue(f, v[f.name]) });
    }
  }
  return cols;
}

// Âge en années révolues à une date donnée (dates AAAA-MM-JJ)
function ageAt(birthdate, date) {
  if (!birthdate || !date) return '';
  const b = new Date(birthdate);
  const d = new Date(date);
  if (Number.isNaN(b) || Number.isNaN(d)) return '';
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
  return age >= 0 && age < 120 ? age : '';
}

// Valeurs initiales d'un formulaire à partir d'un autre (ex. rapport d'accident -> rapport médical)
function prefill(form, source) {
  const values = {};
  for (const f of allFields(form)) {
    if (typeof f.prefill === 'function') values[f.name] = f.prefill(source) ?? '';
  }
  return values;
}

// Le formulaire contient-il une valeur dans cette section ? (pour déplier les sections facultatives)
const sectionHasValues = (section, values) =>
  section.fields.some((f) => {
    const v = values[f.name];
    if (v === undefined || v === null || v === '' || v === false) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return true;
  });

module.exports = { pseudonymizedColumns, ageAt, validate, toDisplay, formatValue, exportColumns, allFields, isVisible, cellName, prefill, sectionHasValues };
