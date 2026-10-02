'use strict';

// Formulaire « Rapport médical » rempli par le médecin intervenant.
// ⚠️ Pour aligner sur le formulaire Jotform de référence, modifier uniquement ce fichier.

const YES_NO = ['Oui', 'Non'];
const EVACUATED = { field: 'outcome', equals: 'Évacuation vers un centre hospitalier' };

module.exports = {
  id: 'medical',
  version: 1,
  title: 'Rapport médical',
  intro: 'Données de santé à caractère confidentiel, hébergées chez un hébergeur certifié HDS.',
  sections: [
    {
      title: 'Médecin',
      fields: [
        { name: 'doctor_last_name', label: 'Nom', type: 'text', required: true, width: 'half', prefill: 'doctor_last_name' },
        { name: 'doctor_first_name', label: 'Prénom', type: 'text', required: true, width: 'half', prefill: 'doctor_first_name' },
        { name: 'rpps', label: 'N° RPPS', type: 'text', width: 'half', pattern: '^\\d{11}$', patternMessage: 'Le n° RPPS comporte 11 chiffres.' },
        { name: 'doctor_phone', label: 'Téléphone', type: 'tel', width: 'half', prefill: 'doctor_phone' },
        {
          name: 'doctor_function',
          label: 'Fonction sur l’épreuve',
          type: 'select',
          required: true,
          options: ['Médecin-chef de l’épreuve', 'Médecin d’intervention', 'Médecin du centre médical', 'Médecin hospitalier', 'Autre'],
        },
        {
          name: 'specialty',
          label: 'Spécialité',
          type: 'select',
          options: ['Médecine d’urgence', 'Anesthésie-réanimation', 'Médecine générale', 'Médecine du sport', 'Autre'],
        },
      ],
    },
    {
      title: 'Bilan initial',
      fields: [
        { name: 'exam_time', label: 'Heure du premier examen', type: 'time', required: true, width: 'half' },
        { name: 'exam_place', label: 'Lieu de l’examen', type: 'select', width: 'half', options: ['Sur le lieu de l’accident', 'Centre médical', 'Autre'] },
        { name: 'loss_of_consciousness', label: 'Perte de connaissance initiale', type: 'radio', required: true, options: ['Oui', 'Non', 'Ne sait pas'] },
        { name: 'gcs', label: 'Score de Glasgow initial', type: 'number', min: 3, max: 15, width: 'half' },
        { name: 'pain_score', label: 'Douleur (EN 0 à 10)', type: 'number', min: 0, max: 10, width: 'half' },
        { name: 'heart_rate', label: 'Fréquence cardiaque (/min)', type: 'number', min: 0, max: 300, width: 'half' },
        { name: 'blood_pressure', label: 'Pression artérielle (mmHg)', type: 'text', placeholder: '120/80', width: 'half', pattern: '^\\d{2,3}\\s*/\\s*\\d{2,3}$', patternMessage: 'Format attendu : 120/80' },
        { name: 'spo2', label: 'SpO2 (%)', type: 'number', min: 0, max: 100, width: 'half' },
        { name: 'resp_rate', label: 'Fréquence respiratoire (/min)', type: 'number', min: 0, max: 80, width: 'half' },
      ],
    },
    {
      title: 'Lésions',
      fields: [
        {
          name: 'injured_regions',
          label: 'Régions atteintes',
          type: 'checkboxes',
          required: true,
          options: [
            'Aucune lésion',
            'Tête / face',
            'Rachis cervical',
            'Rachis dorsal / lombaire',
            'Thorax',
            'Abdomen',
            'Bassin',
            'Membre supérieur droit',
            'Membre supérieur gauche',
            'Membre inférieur droit',
            'Membre inférieur gauche',
          ],
        },
        {
          name: 'injury_types',
          label: 'Nature des lésions',
          type: 'checkboxes',
          options: [
            'Contusion',
            'Plaie',
            'Fracture (suspectée ou avérée)',
            'Entorse / luxation',
            'Brûlure',
            'Traumatisme crânien',
            'Commotion cérébrale suspectée',
            'Malaise / pathologie médicale',
            'Autre',
          ],
        },
        {
          name: 'burn_details',
          label: 'Brûlures : localisation, profondeur, % de surface corporelle',
          type: 'textarea',
          rows: 2,
          showIf: { field: 'injury_types', includes: 'Brûlure' },
        },
        { name: 'clinical_findings', label: 'Examen clinique / bilan lésionnel', type: 'textarea', required: true, rows: 5 },
        { name: 'diagnosis', label: 'Diagnostic retenu ou suspecté', type: 'textarea', rows: 3 },
        {
          name: 'severity',
          label: 'Gravité',
          type: 'radio',
          required: true,
          options: [
            'Indemne',
            'Blessure légère (soins sur place)',
            'Blessure modérée (hospitalisation, pronostic non engagé)',
            'Blessure grave (urgence absolue, pronostic engagé)',
            'Décès',
          ],
        },
      ],
    },
    {
      title: 'Soins réalisés',
      fields: [
        {
          name: 'treatments',
          label: 'Gestes et traitements',
          type: 'checkboxes',
          options: [
            'Aucun',
            'Soins locaux / pansement',
            'Immobilisation (attelle, collier cervical)',
            'Plan dur / matelas immobilisateur',
            'Oxygénothérapie',
            'Voie veineuse / remplissage',
            'Antalgiques',
            'Intubation / ventilation',
            'Réanimation cardio-pulmonaire',
            'Autre',
          ],
        },
        { name: 'treatment_details', label: 'Précisions (molécules, doses, horaires…)', type: 'textarea', rows: 3 },
      ],
    },
    {
      title: 'Orientation',
      fields: [
        {
          name: 'outcome',
          label: 'Devenir',
          type: 'select',
          required: true,
          options: [
            'Retour paddock – reprise possible',
            'Retour paddock – sans reprise',
            'Évacuation vers un centre hospitalier',
            'Décès',
          ],
        },
        { name: 'hospital_name', label: 'Établissement de destination', type: 'text', required: true, showIf: EVACUATED },
        { name: 'transport', label: 'Moyen de transport', type: 'select', width: 'half', options: ['Ambulance', 'VSAV (pompiers)', 'SMUR', 'Hélicoptère'], showIf: EVACUATED },
        { name: 'departure_time', label: 'Heure de départ', type: 'time', width: 'half', showIf: EVACUATED },
        { name: 'medicalised', label: 'Transport médicalisé', type: 'radio', options: YES_NO, showIf: EVACUATED },
      ],
    },
    {
      title: 'Aptitude et suivi',
      fields: [
        {
          name: 'fitness',
          label: 'Aptitude à la reprise de la compétition',
          type: 'radio',
          required: true,
          options: ['Apte', 'Inapte pour la suite de l’épreuve', 'Inapte – avis du médecin fédéral requis avant reprise'],
        },
        { name: 'concussion_protocol', label: 'Protocole commotion cérébrale déclenché', type: 'radio', options: YES_NO, width: 'half' },
        { name: 'license_restriction', label: 'Visite médicale de reprise recommandée', type: 'radio', options: YES_NO, width: 'half' },
        { name: 'follow_up', label: 'Recommandations / suivi', type: 'textarea', rows: 3 },
      ],
    },
    {
      title: 'Validation',
      fields: [
        { name: 'attachments', label: 'Documents (comptes rendus, imagerie…)', type: 'file', multiple: true, help: 'Images ou PDF.' },
        { name: 'comments', label: 'Observations', type: 'textarea', rows: 3 },
        { name: 'certify', label: 'Je certifie l’exactitude des informations médicales transmises.', type: 'consent', required: true },
        { name: 'signature', label: 'Signature du médecin', type: 'signature', required: true },
      ],
    },
  ],
};
