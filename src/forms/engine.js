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
  for (const f of allFields(form)) {
    if (f.type === 'checkboxes') raw[f.name] = asArray(body[f.name]).map(String);
    else if (f.type === 'consent') raw[f.name] = body[f.name] ? true : false;
    else if (f.type !== 'file') raw[f.name] = typeof body[f.name] === 'string' ? body[f.name].trim() : '';
  }

  const values = {};
  const errors = {};
  for (const f of allFields(form)) {
    if (!isVisible(f, raw)) continue;
    const v = raw[f.name];
    const empty =
      f.type === 'file'
        ? !(files[f.name] && files[f.name].length)
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
      fields: s.fields
        .filter((f) => f.type !== 'file' && isVisible({ ...f, section: s }, values) && values[f.name] !== undefined)
        .map((f) => ({ ...f, display: formatValue(f, values[f.name]) })),
    }))
    .filter((s) => s.fields.length);
}

// Colonnes pour l'export CSV (hors signature et fichiers)
const exportColumns = (form) =>
  allFields(form).filter((f) => !['file', 'signature'].includes(f.type));

module.exports = { validate, toDisplay, formatValue, exportColumns, allFields, isVisible };
