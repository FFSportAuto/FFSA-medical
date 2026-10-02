'use strict';

// Formulaire « Rapport d'accident » rempli par l'organisateur.
// ⚠️ Pour aligner sur le formulaire Jotform de référence, modifier uniquement ce fichier :
// le rendu, la validation, l'affichage back office et l'export CSV s'adaptent automatiquement.

const YES_NO = ['Oui', 'Non'];
const PILOT_ROLES = ['Pilote', 'Copilote'];

module.exports = {
  id: 'accident',
  version: 1,
  title: "Rapport d'accident",
  intro:
    "À compléter par l'organisateur ou le directeur de course pour chaque personne blessée. " +
    'Le médecin désigné en fin de formulaire recevra automatiquement une demande de rapport médical.',
  sections: [
    {
      title: "L'épreuve",
      fields: [
        { name: 'event_name', label: "Nom de l'épreuve", type: 'text', required: true },
        { name: 'event_date', label: "Date de l'accident", type: 'date', required: true, width: 'half' },
        { name: 'accident_time', label: "Heure de l'accident", type: 'time', required: true, width: 'half' },
        { name: 'event_location', label: 'Lieu / circuit', type: 'text', required: true },
        {
          name: 'discipline',
          label: 'Discipline',
          type: 'select',
          required: true,
          width: 'half',
          options: [
            'Rallye',
            'Rallye VHC / VHRS',
            'Circuit',
            'Course de côte',
            'Slalom',
            'Karting',
            'Tout-terrain',
            'Rallycross / Autocross / Sprint car',
            'Drift',
            'Énergies nouvelles',
            'Autre',
          ],
        },
        {
          name: 'discipline_other',
          label: 'Préciser la discipline',
          type: 'text',
          width: 'half',
          required: true,
          showIf: { field: 'discipline', equals: 'Autre' },
        },
        { name: 'asa', label: 'ASA / organisateur', type: 'text', required: true, width: 'half' },
        { name: 'event_permit', label: "N° de permis d'organisation", type: 'text', width: 'half' },
        {
          name: 'session_type',
          label: 'Phase de l’épreuve',
          type: 'select',
          options: ['Reconnaissances', 'Essais libres', 'Essais chronométrés', 'Course / épreuve spéciale', 'Liaison', 'Parc / paddock', 'Autre'],
        },
      ],
    },
    {
      title: 'Déclarant',
      fields: [
        { name: 'declarant_name', label: 'Nom et prénom', type: 'text', required: true, width: 'half' },
        {
          name: 'declarant_role',
          label: 'Fonction',
          type: 'select',
          required: true,
          width: 'half',
          options: ['Directeur de course', 'Directeur de course adjoint', 'Responsable sécurité', 'Commissaire', 'Organisateur', 'Autre'],
        },
        { name: 'declarant_phone', label: 'Téléphone', type: 'tel', required: true, width: 'half' },
        { name: 'declarant_email', label: 'E-mail', type: 'email', required: true, width: 'half' },
      ],
    },
    {
      title: 'Personne accidentée',
      fields: [
        {
          name: 'victim_role',
          label: 'Qualité',
          type: 'radio',
          required: true,
          options: ['Pilote', 'Copilote', 'Commissaire', 'Officiel', 'Spectateur', "Membre d'équipe / assistance", 'Autre'],
        },
        { name: 'victim_last_name', label: 'Nom', type: 'text', required: true, width: 'half' },
        { name: 'victim_first_name', label: 'Prénom', type: 'text', required: true, width: 'half' },
        { name: 'victim_birthdate', label: 'Date de naissance', type: 'date', width: 'half' },
        { name: 'victim_sex', label: 'Sexe', type: 'radio', options: ['Homme', 'Femme'], width: 'half' },
        {
          name: 'victim_license',
          label: 'N° de licence FFSA',
          type: 'text',
          width: 'half',
          showIf: { field: 'victim_role', in: ['Pilote', 'Copilote', 'Commissaire', 'Officiel'] },
        },
        { name: 'victim_nationality', label: 'Nationalité', type: 'text', width: 'half' },
        { name: 'victim_phone', label: 'Téléphone', type: 'tel', width: 'half' },
        { name: 'victim_email', label: 'E-mail', type: 'email', width: 'half' },
        { name: 'victim_address', label: 'Adresse', type: 'textarea', rows: 2 },
        { name: 'emergency_contact', label: 'Personne à prévenir (nom, lien, téléphone)', type: 'text' },
      ],
    },
    {
      title: 'Véhicule et équipements',
      showIf: { field: 'victim_role', in: PILOT_ROLES },
      fields: [
        { name: 'vehicle', label: 'Marque et modèle', type: 'text', width: 'half' },
        { name: 'race_number', label: 'N° de course', type: 'text', width: 'half' },
        { name: 'vehicle_class', label: 'Groupe / classe', type: 'text', width: 'half' },
        {
          name: 'safety_equipment',
          label: 'Équipements de sécurité portés / présents',
          type: 'checkboxes',
          options: ['Casque', 'RFT (HANS…)', 'Combinaison ignifugée', 'Gants / sous-vêtements ignifugés', 'Harnais', 'Siège baquet', 'Arceau / cellule de sécurité', 'Filet de fenêtre'],
        },
      ],
    },
    {
      title: "Circonstances de l'accident",
      fields: [
        { name: 'accident_place', label: 'Localisation précise (ES, virage, PK, zone…)', type: 'text', required: true },
        { name: 'weather', label: 'Météo', type: 'select', width: 'half', options: ['Beau / sec', 'Couvert', 'Pluie', 'Brouillard', 'Neige / verglas'] },
        { name: 'track_condition', label: 'État de la piste / route', type: 'select', width: 'half', options: ['Sèche', 'Humide', 'Mouillée', 'Grasse / boueuse', 'Gravier / terre', 'Neige / glace'] },
        {
          name: 'accident_type',
          label: "Type d'accident",
          type: 'checkboxes',
          required: true,
          options: [
            'Sortie de route',
            'Tonneau(x)',
            'Choc frontal',
            'Choc latéral',
            'Choc arrière',
            'Collision avec un autre véhicule',
            'Choc contre un obstacle (rail, mur, arbre…)',
            'Incendie',
            'Personne percutée',
            'Chute',
            'Malaise',
            'Autre',
          ],
        },
        { name: 'estimated_speed', label: "Vitesse estimée à l'impact (km/h)", type: 'number', min: 0, max: 400, width: 'half' },
        { name: 'red_flag', label: 'Neutralisation / drapeau rouge', type: 'radio', options: YES_NO, width: 'half' },
        { name: 'description', label: "Description de l'accident", type: 'textarea', required: true, rows: 6 },
      ],
    },
    {
      title: 'Intervention et secours',
      fields: [
        { name: 'alert_time', label: "Heure de l'alerte", type: 'time', width: 'half' },
        { name: 'intervention_time', label: 'Heure d’arrivée des secours', type: 'time', width: 'half' },
        {
          name: 'rescue_means',
          label: 'Moyens engagés',
          type: 'checkboxes',
          options: ['Médecin de l’épreuve', 'Véhicule d’intervention rapide', 'Ambulance', 'Équipe de désincarcération', 'Véhicule incendie', 'SMUR / SAMU', 'Pompiers (SDIS)', 'Hélicoptère'],
        },
        { name: 'extrication', label: 'Désincarcération nécessaire', type: 'radio', options: YES_NO, width: 'half' },
        { name: 'self_exit', label: 'Sortie du véhicule par ses propres moyens', type: 'radio', options: YES_NO, width: 'half', showIf: { field: 'victim_role', in: PILOT_ROLES } },
        { name: 'conscious', label: 'Victime consciente à l’arrivée des secours', type: 'radio', options: ['Oui', 'Non', 'Ne sait pas'] },
        {
          name: 'evacuation',
          label: 'Évacuation',
          type: 'select',
          required: true,
          width: 'half',
          options: ['Aucune (laissé sur place)', 'Centre médical de l’épreuve', 'Centre hospitalier', 'Autre'],
        },
        {
          name: 'hospital_name',
          label: 'Établissement hospitalier',
          type: 'text',
          width: 'half',
          showIf: { field: 'evacuation', equals: 'Centre hospitalier' },
        },
        {
          name: 'evacuation_means',
          label: 'Moyen d’évacuation',
          type: 'select',
          width: 'half',
          options: ['Ambulance', 'VSAV (pompiers)', 'SMUR', 'Hélicoptère', 'Véhicule personnel'],
          showIf: { field: 'evacuation', in: ['Centre médical de l’épreuve', 'Centre hospitalier', 'Autre'] },
        },
      ],
    },
    {
      title: 'Médecin intervenant',
      intro: 'Ce médecin recevra par e-mail un lien sécurisé pour compléter le rapport médical.',
      fields: [
        { name: 'doctor_last_name', label: 'Nom du médecin', type: 'text', required: true, width: 'half' },
        { name: 'doctor_first_name', label: 'Prénom du médecin', type: 'text', required: true, width: 'half' },
        { name: 'doctor_email', label: 'E-mail du médecin', type: 'email', required: true, width: 'half' },
        { name: 'doctor_phone', label: 'Téléphone du médecin', type: 'tel', required: true, width: 'half' },
      ],
    },
    {
      title: 'Compléments et validation',
      fields: [
        { name: 'witnesses', label: 'Témoins / autres personnes impliquées', type: 'textarea', rows: 3 },
        { name: 'attachments', label: 'Photos, croquis, documents', type: 'file', multiple: true, help: 'Images ou PDF.' },
        { name: 'certify', label: 'Je certifie l’exactitude des informations déclarées.', type: 'consent', required: true },
        { name: 'signature', label: 'Signature du déclarant', type: 'signature', required: true },
      ],
    },
  ],
};
