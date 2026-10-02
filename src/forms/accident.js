'use strict';

// Formulaire « Rapport d'accident » rempli par le directeur de course / l'organisateur.
// Reprend le formulaire Jotform FFSA 260223577062049.
// Pour modifier un champ, il suffit d'éditer ce fichier : rendu, validation, back office et export suivent.

const VEHICLE_TYPES = [
  'Monoplace',
  'Kart',
  'Voiture de tourisme (y compris SUV et 4x4)',
  'GT',
  'Voiture de sport deux places',
  'Prototype Le Mans (LMP)',
  'Silhouette',
  'Camion',
  'Buggy',
  'Dragster',
  'Autre',
];

function vehicleSection(n) {
  const p = `vehicle${n}_`;
  return {
    title: n === 1 ? 'Pilote / copilote accidenté' : `Autre pilote / copilote accidenté (${n})`,
    optional: n > 1,
    shareWithDoctor: true,
    fields: [
      { name: `${p}driver_name`, label: 'Nom et prénom du pilote / copilote', type: 'text', width: 'half' },
      { name: `${p}license`, label: 'Licence n°', type: 'text', width: 'half' },
      { name: `${p}number`, label: 'Concurrent n°', type: 'text', width: 'half' },
      { name: `${p}group`, label: 'Groupe', type: 'text', width: 'half' },
      { name: `${p}kart_category`, label: 'Catégorie (karting)', type: 'text', width: 'half' },
      { name: `${p}vehicle_type`, label: 'Type de véhicule', type: 'select', width: 'half', options: VEHICLE_TYPES },
      { name: `${p}dragster_category`, label: 'Catégorie de dragster', type: 'text', width: 'half', showIf: { field: `${p}vehicle_type`, equals: 'Dragster' } },
      { name: `${p}make`, label: 'Marque', type: 'text', width: 'half' },
      { name: `${p}model`, label: 'Modèle', type: 'text', width: 'half' },
      { name: `${p}year`, label: 'Année de construction', type: 'text', width: 'half' },
    ],
  };
}

function otherPersonSection(n) {
  const p = `person${n}_`;
  return {
    title: `Autre personne accidentée (${n}) – spectateur, officiel…`,
    optional: true,
    shareWithDoctor: true,
    fields: [
      { name: `${p}name`, label: 'Nom et prénom', type: 'text', width: 'half' },
      { name: `${p}license`, label: 'Licence n°', type: 'text', width: 'half' },
      { name: `${p}role`, label: 'Qualité', type: 'text', width: 'half' },
      { name: `${p}address`, label: 'Adresse (si non licencié)', type: 'text', width: 'half' },
    ],
  };
}

function witnessSection(n) {
  const p = `witness${n}_`;
  return {
    title: n === 1 ? "Témoin de l'accident" : `Autre témoin (${n})`,
    optional: n > 1,
    intro:
      n === 1
        ? "À compléter OBLIGATOIREMENT si la classification médicale est de 3 à 4 et/ou en cas d'incendie. " +
          'À remplir par le directeur de course, le ou les officiels, pilotes ou spectateurs témoins (notamment en rallye, course de côte, slalom…).'
        : null,
    fields: [
      { name: `${p}first_name`, label: 'Prénom', type: 'text', width: 'half' },
      { name: `${p}last_name`, label: 'Nom', type: 'text', width: 'half' },
      { name: `${p}role`, label: 'Qualité', type: 'text' },
      { name: `${p}signature`, label: 'Signature', type: 'signature' },
    ],
  };
}

const withOther = (name, label, options) => [
  { name, label, type: 'checkboxes', options: [...options, 'Autre'] },
  { name: `${name}_other`, label: `${label} – autre (préciser)`, type: 'text', showIf: { field: name, includes: 'Autre' } },
];

module.exports = {
  id: 'accident',
  version: 2,
  title: "Rapport d'accident",
  intro:
    "À remplir dans les 48 heures après l'accident par le directeur de course, " +
    'et aussi en cas d’incident médical (malaise cardiaque au volant…). ' +
    'Le rapport d’accident et le rapport médical sont transmis directement au service médical de la FFSA.',
  sections: [
    {
      title: "Médecin de l'épreuve",
      intro:
        'Le rapport médical doit être rempli par le médecin de l’épreuve. ' +
        'Renseignez ses coordonnées : le formulaire en ligne lui sera directement envoyé par e-mail.',
      fields: [
        { name: 'doctor_first_name', label: 'Prénom du médecin', type: 'text', required: true, width: 'half' },
        { name: 'doctor_last_name', label: 'Nom du médecin', type: 'text', required: true, width: 'half' },
        { name: 'doctor_email', label: 'Adresse e-mail du médecin', type: 'email', required: true },
      ],
    },
    {
      title: 'Synthèse – accident avec blessé (évacué par ambulance) ou plus grave',
      intro: 'À remplir impérativement en cas d’accident avec blessé évacué par ambulance, ou plus grave.',
      shareWithDoctor: true,
      fields: [
        { name: 'summary_victim_name', label: 'Nom et prénom de la personne accidentée', type: 'text', width: 'half' },
        { name: 'summary_victim_license', label: 'N° de licence', type: 'text', width: 'half' },
        { name: 'accident_date', label: "Date de l'accident", type: 'date', required: true, width: 'half' },
        { name: 'accident_time', label: "Heure de l'accident", type: 'time', width: 'half' },
        { name: 'circumstances', label: "Circonstances de l'accident", type: 'textarea', rows: 5 },
        { name: 'heading_monday', label: "Personne de l'organisation joignable par téléphone le lundi matin", type: 'heading' },
        { name: 'monday_contact_name', label: 'Nom et prénom', type: 'text', width: 'half' },
        { name: 'monday_contact_phone', label: 'N° de téléphone', type: 'tel', width: 'half' },
        { name: 'hospitalised_count', label: 'Nombre de blessés hospitalisés', type: 'number', min: 0, max: 999, width: 'half' },
        { name: 'deaths_count', label: 'Nombre de décès éventuels', type: 'number', min: 0, max: 999, width: 'half' },
      ],
    },
    {
      title: "L'épreuve",
      shareWithDoctor: true,
      fields: [
        { name: 'league', label: 'Ligue', type: 'text', width: 'half' },
        { name: 'asa', label: 'A.S.A. – ASK', type: 'text', width: 'half' },
        { name: 'as_code', label: 'Code A.S', type: 'text', width: 'half' },
        { name: 'visa_number', label: 'Numéro de visa', type: 'text', width: 'half' },
        { name: 'event_name', label: "Nom de l'épreuve", type: 'text', required: true, width: 'half' },
        { name: 'event_location', label: "Lieu de l'épreuve", type: 'text', width: 'half' },
        {
          name: 'discipline',
          label: 'Discipline',
          type: 'select',
          width: 'half',
          options: [
            'Circuit asphalte',
            'Rallye',
            'Karting',
            'Course de côte',
            'Rallye tout-terrain',
            'Dragster / Épreuves d’accélération',
            'Autocross',
            'Rallycross',
            'Drift',
            '2 CV Cross / 4L Cross',
            'Fol’Car',
            'Camion Cross',
            'Slalom',
            'Trial',
            'Endurance Tout terrain',
            'Autre',
          ],
        },
        { name: 'discipline_other', label: 'Préciser la discipline', type: 'text', width: 'half', showIf: { field: 'discipline', equals: 'Autre' } },
        {
          name: 'event_level',
          label: "Niveau de l'épreuve",
          type: 'select',
          width: 'half',
          options: [
            'Championnat, Trophée ou Coupe FIA/CIK',
            'Championnat, Trophée ou Coupe FFSA',
            'Série internationale',
            'Épreuve internationale',
            'Épreuve nationale',
            'Épreuve régionale',
            'Événement de club',
            'Autre',
          ],
        },
        { name: 'event_date', label: "Date de l'épreuve", type: 'date', required: true, width: 'half' },
        {
          name: 'casualties',
          label: 'Bilan humain',
          type: 'matrix',
          rows: ['Pilotes', 'Copilotes', 'Médias accrédités', 'Officiels', "Personnel d'équipe", 'Spectateurs / riverains', 'Autres'],
          columns: ['Nombre de blessés', 'Nombre de décès'],
          cell: { type: 'number', min: 0, max: 999 },
        },
      ],
    },
    vehicleSection(1),
    vehicleSection(2),
    vehicleSection(3),
    otherPersonSection(1),
    otherPersonSection(2),
    otherPersonSection(3),
    otherPersonSection(4),
    {
      title: 'Conditions météo',
      fields: [
        ...withOther('weather', 'Conditions atmosphériques', ['Temps clair', 'Nuageux', 'Brouillard', 'Précipitations', 'Neige / Verglas', 'Grêle']),
        { name: 'temperature', label: 'Température', type: 'text', width: 'half' },
        ...withOther('visibility', 'Visibilité', ['Bonne', 'Moyenne', 'Mauvaise', 'Nuit']),
      ],
    },
    {
      title: 'Type de revêtement',
      fields: [
        ...withOther('surface', 'Revêtement', ['Asphalte', 'Gravier / Terre']),
        ...withOther('track_layout', 'Configuration du tracé', ['Plat', 'En montée', 'Sommet de côte / Crête', 'En descente']),
        ...withOther('track_condition', 'État du tracé', ['Sec', 'Mouillé', 'Huileux', 'Graviers', 'Débris', 'Neige / Verglas']),
      ],
    },
    {
      title: "Étude de l'équipement",
      fields: [
        {
          name: 'equipment',
          label: 'Observations par véhicule concurrent',
          type: 'matrix',
          rows: [
            'Numéro',
            'Combinaison du pilote / copilote',
            'Casque',
            'Visière',
            'Hans / Simpson',
            'Harnais de sécurité',
            'Arceau de sécurité',
            'Extincteur à bord',
            'Extincteur utilisé ? (oui / non)',
          ],
          columns: ['Véhicule 1', 'Véhicule 2', 'Véhicule 3'],
          cell: { type: 'text' },
        },
        { name: 'equipment_comments', label: 'Commentaires spécifiques (exemple : problème avec système Hans / Simpson)', type: 'textarea', rows: 3 },
      ],
    },
    {
      title: "Schéma de l'accident",
      intro:
        'À compléter pour toute classification médicale. Indiquez : numéro de poste et emplacement ; numéro de licence des officiels ' +
        'présents dans la zone de l’accident ; la protection du bord de la piste ; les drapeaux et/ou signaux lumineux utilisés ' +
        'immédiatement avant l’accident ; le(s) véhicule(s) et leur(s) numéro(s) ; point GPS de l’accident. ' +
        'Transmettre obligatoirement des photos de l’accident sur place ainsi que du véhicule. ' +
        'Sur circuit, le schéma devra être réalisé en utilisant un zoom du plan.',
      fields: [{ name: 'diagram', label: 'Schéma et photos', type: 'file', multiple: true }],
    },
    {
      title: 'Intervention des secours',
      intro:
        'À compléter OBLIGATOIREMENT si la classification médicale est de 3 à 4 et/ou en cas d’incendie. ' +
        'Joindre une copie de la main courante de la direction de course. Indiquez les personnes intervenues ' +
        '(extracteurs, sapeurs-pompiers, SAMU…) et le déroulé horaire des secours (temps depuis l’accident et durée de l’intervention).',
      fields: [
        { name: 'logbook', label: 'Main courante', type: 'file', multiple: true },
        { name: 'rescue_observations', label: 'Observations', type: 'textarea', rows: 5 },
      ],
    },
    witnessSection(1),
    witnessSection(2),
    witnessSection(3),
    witnessSection(4),
    {
      title: 'Rapport établi par',
      fields: [
        { name: 'author_first_name', label: 'Prénom', type: 'text', required: true, width: 'half' },
        { name: 'author_last_name', label: 'Nom', type: 'text', required: true, width: 'half' },
        { name: 'author_role', label: 'Qualité', type: 'text' },
        { name: 'author_date', label: 'Le', type: 'date', width: 'half' },
        { name: 'author_time', label: 'À', type: 'time', width: 'half' },
        { name: 'author_signature', label: 'Signature', type: 'signature' },
      ],
    },
    {
      title: 'Pièces à joindre',
      intro:
        'Témoignages visuels, rapports des commissaires, du directeur de la spéciale, des responsables du service incendie ; ' +
        'rapport des vérifications techniques effectuées sur toutes les voitures accidentées ; tout autre rapport d’expert ' +
        'présentant un intérêt ; photos ou vidéos.',
      fields: [{ name: 'attachments', label: 'Fichiers complémentaires', type: 'file', multiple: true }],
    },
  ],
};
