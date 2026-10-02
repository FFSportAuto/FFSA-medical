'use strict';

// Reprise, dans le rapport médical, des personnes déclarées par l'organisateur.
// Chaque personne a une clé stable (vehicle1, person2, summary…) qui relie le rapport médical
// à la déclaration d'accident.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const fullName = (last, first) => [last, first].filter(Boolean).join(' ');

function patientTypeFromRole(role) {
  const r = norm(role);
  if (/copilot/.test(r)) return ['Copilote'];
  if (/pilot/.test(r)) return ['Pilote'];
  if (/commissaire|officiel|directeur|chrono/.test(r)) return ['Officiel'];
  if (/spectat|public|riverain/.test(r)) return ['Spectateur'];
  return undefined;
}

/**
 * Liste des personnes accidentées déclarées, sans doublon (la synthèse reprend souvent le pilote n°1).
 * @returns [{ key, name, detail, prefill }]  prefill = valeurs du formulaire médical
 */
function declaredPersons(a) {
  const out = [];
  const add = (key, last, first, detail, prefill) => {
    if (!last && !first) return;
    const name = fullName(last, first);
    const twin = out.find((p) => norm(p.name) === norm(name));
    if (twin) {
      // Même personne : on complète les informations manquantes
      for (const [k, v] of Object.entries(prefill)) if (v !== undefined && v !== '' && !twin.prefill[k]) twin.prefill[k] = v;
      return;
    }
    out.push({ key, name, detail, prefill: { patient_last_name: last || '', patient_first_name: first || '', ...prefill } });
  };

  for (let n = 1; n <= 3; n++) {
    const p = `vehicle${n}_`;
    const role = a[`${p}driver_role`];
    add(`vehicle${n}`, a[`${p}driver_last_name`], a[`${p}driver_first_name`],
      [role || 'Pilote / copilote', a[`${p}number`] && `n° ${a[`${p}number`]}`, [a[`${p}make`], a[`${p}model`]].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
      {
        patient_type: role ? [role] : undefined,
        license: a[`${p}license`],
        crew_number: a[`${p}number`],
        category: a[`${p}group`] || a[`${p}kart_category`],
      });
  }
  for (let n = 1; n <= 4; n++) {
    const p = `person${n}_`;
    add(`person${n}`, a[`${p}last_name`], a[`${p}first_name`], a[`${p}role`] || 'Autre personne', {
      patient_type: patientTypeFromRole(a[`${p}role`]),
      license: a[`${p}license`],
      address: a[`${p}address`],
    });
  }
  add('summary', a.summary_victim_last_name, a.summary_victim_first_name, 'Personne indiquée dans la synthèse', {
    license: a.summary_victim_license,
  });
  for (const p of out) for (const k of Object.keys(p.prefill)) if (p.prefill[k] === undefined || p.prefill[k] === '') delete p.prefill[k];
  return out;
}

module.exports = { declaredPersons, patientTypeFromRole };
