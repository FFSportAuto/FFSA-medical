'use strict';

// Règles du formulaire d'inscription des directeurs de course (sans dépendance : réutilisées par la démo en ligne).

const JOB_TITLES = ['Directeur de course', 'Directeur de course adjoint', 'Responsable sécurité', 'Organisateur / ASA', 'Secrétaire d’épreuve', 'Autre'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignup(b) {
  const v = {
    last_name: String(b.last_name || '').trim().slice(0, 100),
    first_name: String(b.first_name || '').trim().slice(0, 100),
    email: String(b.email || '').trim().toLowerCase().slice(0, 200),
    phone: String(b.phone || '').trim().slice(0, 30),
    job_title: String(b.job_title || ''),
    license_number: String(b.license_number || '').trim().slice(0, 30),
  };
  const errors = {};
  if (!v.last_name) errors.last_name = 'Champ obligatoire.';
  if (!v.first_name) errors.first_name = 'Champ obligatoire.';
  if (!EMAIL_RE.test(v.email)) errors.email = 'Adresse e-mail invalide.';
  if (!/^[+()0-9.\s-]{6,25}$/.test(v.phone)) errors.phone = 'Numéro de téléphone invalide.';
  if (!JOB_TITLES.includes(v.job_title)) errors.job_title = 'Choix invalide.';
  return { v, errors };
}

module.exports = { JOB_TITLES, EMAIL_RE, validateSignup };
