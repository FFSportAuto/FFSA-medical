'use strict';

// Formulaire « Rapport médical d'épreuve » rempli par le médecin, un par patient consulté.
// Reprend le formulaire Jotform FFSA 260263404021340.

const INJURY_CODES = ['C', 'D', 'E', 'F', 'H', 'L', 'P', 'B'];
const YES_NO = ['Oui', 'Non'];
const injuryCell = { type: 'select', options: INJURY_CODES };

module.exports = {
  id: 'medical',
  version: 2,
  title: "Rapport médical d'épreuve",
  intro: 'À remplir dans les 48 heures après l’accident par le médecin. Merci de remplir un formulaire par patient consulté.',
  sections: [
    {
      title: "L'épreuve",
      fields: [
        { name: 'date', label: 'Date', type: 'date', width: 'half', prefill: (a) => a.accident_date },
        { name: 'time', label: 'Heure', type: 'time', width: 'half', prefill: (a) => a.accident_time },
        { name: 'place', label: 'Lieu / ES', type: 'text', width: 'half', prefill: (a) => a.event_location },
        { name: 'post', label: 'Poste', type: 'text', width: 'half' },
        { name: 'event', label: 'Épreuve', type: 'text', width: 'half', prefill: (a) => a.event_name },
        { name: 'category', label: 'Catégorie', type: 'text', width: 'half' },
        { name: 'session_type', label: 'Type', type: 'checkboxes', options: ['Course', 'Essais'] },
      ],
    },
    {
      title: 'Patient',
      fields: [
        { name: 'patient_type', label: 'Type', type: 'checkboxes', options: ['Pilote', 'Copilote', 'Officiel', 'Spectateur'] },
        { name: 'patient_last_name', label: 'Nom', type: 'text', required: true, width: 'half' },
        { name: 'patient_first_name', label: 'Prénom', type: 'text', required: true, width: 'half' },
        { name: 'license', label: 'N° de licence', type: 'text', width: 'half' },
        { name: 'crew_number', label: "N° d'équipage", type: 'text', width: 'half' },
        { name: 'birthdate', label: 'Date de naissance', type: 'date', width: 'half' },
        { name: 'nationality', label: 'Nationalité', type: 'text', width: 'half' },
        { name: 'phone', label: 'Numéro de téléphone', type: 'tel', width: 'half' },
        { name: 'address', label: 'Adresse', type: 'text', width: 'half' },
      ],
    },
    {
      title: 'Circonstances et bilan',
      fields: [
        {
          name: 'conditions',
          label: 'Condition(s)',
          type: 'checkboxes',
          options: ['Collision', 'Problème mécanique', "Évitement d'un obstacle", 'Collision public', 'Tonneau', 'Choc contre glissière', 'Choc latéral / choc frontal'],
        },
        { name: 'heading_hemo', label: 'Bilan hémodynamique', type: 'heading' },
        { name: 'bp', label: 'TA', type: 'text', width: 'third' },
        { name: 'pulse', label: 'Pouls', type: 'text', width: 'third' },
        { name: 'hemo_other', label: 'Autre', type: 'text', width: 'third' },
        { name: 'heading_resp', label: 'Bilan respiratoire', type: 'heading' },
        { name: 'resp_rate', label: 'Fréquence', type: 'text', width: 'half' },
        { name: 'sao2', label: 'SaO2', type: 'text', width: 'half' },
        { name: 'coloration', label: 'Coloration', type: 'select', width: 'half', options: ['Normal', 'Cyanose', 'Pâleur'] },
        { name: 'rib_injury', label: 'Lésions costales', type: 'select', width: 'half', options: YES_NO },
        { name: 'heading_neuro', label: 'Bilan neurologique', type: 'heading' },
        { name: 'tc', label: 'TC', type: 'text', width: 'half' },
        { name: 'pci', label: 'PCI', type: 'select', width: 'half', options: YES_NO },
        { name: 'glasgow', label: 'Glasgow', type: 'text', width: 'half' },
        { name: 'neuro_other', label: 'Autre', type: 'text', width: 'half' },
      ],
    },
    {
      title: 'Localisation(s) apparente(s) et type(s) de blessure(s)',
      intro:
        'Indiquer par une lettre le type de blessure dans la ou les cases correspondantes : C : contusion · D : dermabrasion · ' +
        'E : entorse · F : fracture · H : hématome · L : luxation · P : plaie · B : brûlure.',
      fields: [
        {
          name: 'upper_limbs',
          label: 'Membres supérieurs',
          type: 'matrix',
          rows: ['Clavicule', 'Épaule', 'Bras', 'Avant-bras', 'Poignet', 'Main / Doigts'],
          columns: ['Droite', 'Gauche'],
          cell: injuryCell,
        },
        {
          name: 'lower_limbs',
          label: 'Membres inférieurs',
          type: 'matrix',
          rows: ['Hanche', 'Fémur', 'Genou (rotule)', 'Jambe', 'Cheville', 'Pied / Orteils'],
          columns: ['Droite', 'Gauche'],
          cell: injuryCell,
        },
        { name: 'spine', label: 'Rachis – zone(s) suspecte(s) de lésion', type: 'checkboxes', options: ['Cervical', 'Dorsal', 'Lombaire', 'Bassin'] },
        { name: 'other_zones', label: 'Autre – zone(s) suspecte(s) de lésion', type: 'checkboxes', options: ['Abdomen', 'Thorax / Côtes', 'Face / Crâne', 'Œil'] },
      ],
    },
    {
      title: 'Conduite à tenir',
      fields: [
        { name: 'decision', label: 'Décision prise', type: 'checkboxes', options: ['Traitement sur place', 'Évacuation urgente', 'Évacuation non urgente', 'Imagerie'] },
        { name: 'heading_onsite', label: 'Sur place', type: 'heading' },
        { name: 'extrication', label: 'Désincarcération', type: 'radio', options: YES_NO, width: 'half' },
        { name: 'extraction', label: 'Extraction', type: 'select', options: ['Rapide', 'Semi rapide', 'ACT', 'Autre'], width: 'half' },
        { name: 'heading_center', label: 'Centre médical', type: 'heading' },
        { name: 'treatments', label: 'Perfusions / traitements', type: 'textarea', rows: 3 },
        { name: 'ventilation', label: 'Ventilation', type: 'text', width: 'half' },
        { name: 'imaging', label: 'Imagerie', type: 'text', width: 'half' },
        { name: 'heading_evac', label: 'Évacuation', type: 'heading' },
        { name: 'evac_vehicle', label: 'Ambulance / VSAV / SMUR', type: 'text', width: 'half' },
        { name: 'medicalised', label: 'Transport médicalisé', type: 'radio', options: YES_NO, width: 'half' },
        { name: 'helicopter', label: 'Hélico', type: 'text', width: 'half' },
        { name: 'hospital', label: 'Hôpital de destination', type: 'text', width: 'half' },
        { name: 'hospital_phone', label: 'Téléphone de l’hôpital', type: 'tel', width: 'half' },
        { name: 'diagnosis', label: 'Diagnostic évoqué', type: 'textarea', rows: 3 },
      ],
    },
    {
      title: 'Conclusion',
      fields: [
        {
          name: 'classification',
          label: 'Classification',
          type: 'radio',
          required: true,
          options: [
            '0 : aucune blessure',
            '1 : traitement sur place',
            "2 : transfert à l'hôpital",
            '3 : intervention ou soins de plus de 21 jours à prévoir',
            '4 : décès',
          ],
        },
        {
          name: 'unfit',
          label: 'Inapte à la pratique du sport automobile',
          type: 'radio',
          options: ['Oui (suspension de licence)', 'Non (pas de suspension de licence)'],
        },
        {
          name: 'current_event',
          label: 'Épreuve en cours',
          type: 'radio',
          options: ['Apte à reprendre', 'Inapte à reprendre'],
          showIf: { field: 'unfit', equals: 'Non (pas de suspension de licence)' },
        },
        { name: 'doctor_name', label: 'Nom du médecin', type: 'text', required: true, width: 'half', prefill: (a) => [a.doctor_first_name, a.doctor_last_name].filter(Boolean).join(' ') },
        { name: 'doctor_phone', label: 'Téléphone', type: 'tel', width: 'half' },
        { name: 'rpps', label: "N° Conseil de l'Ordre ou RPPS", type: 'text', width: 'half' },
        { name: 'comments', label: 'Commentaires libres', type: 'textarea', rows: 4 },
      ],
    },
  ],
};
