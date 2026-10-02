'use strict';

// Dossier fictif complet, utilisé par les tests et pour produire des PDF d'exemple.
// Signature : petit tracé PNG généré (aucune donnée réelle).
const zlib = require('zlib');

function signaturePng() {
  const w = 160, h = 50;
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let x = 10; x < 150; x++) {
    const y = Math.round(25 + 12 * Math.sin(x / 9));
    for (const dy of [0, 1]) {
      const o = (y + dy) * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 20; raw[o + 1] = 30; raw[o + 2] = 80;
    }
  }
  for (let r = 0; r < h; r++) raw[r * (w * 3 + 1)] = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

const SIG = signaturePng();

const accident = {
  id: '00000000-0000-4000-8000-000000000001',
  reference: 'ACC-2026-00042',
  created_at: '2026-10-04T12:40:00Z',
  status: 'complete',
  data: {
    doctor_first_name: 'Claire', doctor_last_name: 'Moreau', doctor_email: 'dr.moreau@exemple.fr', doctor_phone: '06 11 22 33 44',
    summary_victim_last_name: 'Girard', summary_victim_first_name: 'Thomas', summary_victim_license: '254781', accident_date: '2026-10-04', accident_time: '11:20',
    circumstances: 'Perte de contrôle au freinage du virage n°4, sortie dans le bac à graviers puis tonneau. Pilote extrait par l’équipe d’intervention, conscient.',
    monday_contact_name: 'Sophie Laurent', monday_contact_phone: '06 21 43 65 87', hospitalised_count: 1, deaths_count: 0,
    league: 'Nouvelle-Aquitaine', asa: 'ASA Vienne', as_code: '0412', visa_number: 'R-2026-118', event_name: 'Trophée de l’Ouest',
    event_location: 'Circuit du Val de Vienne', discipline: 'Circuit asphalte', event_level: 'Épreuve régionale', event_date: '2026-10-04',
    casualties: { Pilotes: { 'Nombre de blessés': 1 }, Officiels: { 'Nombre de blessés': 1 } },
    vehicle1_driver_role: 'Pilote', vehicle1_driver_last_name: 'Girard', vehicle1_driver_first_name: 'Thomas', vehicle1_license: '254781', vehicle1_number: '27', vehicle1_group: 'GT4', vehicle1_vehicle_type: 'GT', vehicle1_make: 'Alpine', vehicle1_model: 'A110 GT4', vehicle1_year: '2022',
    vehicle2_driver_role: 'Pilote', vehicle2_driver_last_name: 'Petit', vehicle2_driver_first_name: 'Marc', vehicle2_license: '198442', vehicle2_number: '12', vehicle2_vehicle_type: 'Voiture de tourisme (y compris SUV et 4x4)', vehicle2_make: 'Peugeot', vehicle2_model: '308 Racing Cup',
    person1_last_name: 'Bernard', person1_first_name: 'Julien', person1_license: '301122', person1_role: 'Commissaire de piste',
    weather: ['Nuageux'], temperature: '14 °C', visibility: ['Bonne'], surface: ['Asphalte'], track_layout: ['En descente'], track_condition: ['Mouillé', 'Autre'], track_condition_other: 'Traces d’huile',
    equipment: {
      Numéro: { 'Véhicule 1': '27', 'Véhicule 2': '12' }, Casque: { 'Véhicule 1': 'Conforme', 'Véhicule 2': 'Conforme' },
      'Hans / Simpson': { 'Véhicule 1': 'Conforme' }, 'Harnais de sécurité': { 'Véhicule 1': 'Sangle droite détendue' },
      'Extincteur utilisé ? (oui / non)': { 'Véhicule 1': 'Non', 'Véhicule 2': 'Non' },
    },
    equipment_comments: 'Harnais à vérifier par les commissaires techniques.',
    rescue_observations: '11:20 accident – 11:21 drapeau rouge – 11:23 arrivée VIR et médecin – 11:31 extraction – 11:48 départ ambulance.',
    witness1_first_name: 'Paul', witness1_last_name: 'Lefèvre', witness1_role: 'Commissaire poste 4', witness1_signature: SIG,
    witness2_first_name: 'Anne', witness2_last_name: 'Roux', witness2_role: 'Spectatrice',
    author_first_name: 'Jean', author_last_name: 'Martin', author_role: 'Directeur de course', author_date: '2026-10-04', author_time: '13:05', author_signature: SIG,
  },
};

const medicalReports = [
  {
    created_at: '2026-10-04T15:10:00Z',
    data: {
      date: '2026-10-04', time: '11:23', place: 'Virage 4', post: '4', event: 'Trophée de l’Ouest', category: 'GT4', session_type: ['Course'],
      patient_type: ['Pilote'], patient_last_name: 'Girard', patient_first_name: 'Thomas', license: '254781', crew_number: '27', birthdate: '1991-05-12', nationality: 'Française',
      conditions: ['Tonneau', 'Choc contre glissière'], bp: '132/85', pulse: '96', resp_rate: '18', sao2: '98 %', coloration: 'Normal', rib_injury: 'Non', pci: 'Non', glasgow: '15',
      upper_limbs: { Clavicule: { Droite: 'F' }, Épaule: { Droite: 'C' } }, lower_limbs: { Genou: undefined, 'Genou (rotule)': { Gauche: 'D' } }, spine: ['Cervical'], other_zones: ['Thorax / Côtes'],
      decision: ['Évacuation non urgente', 'Imagerie'], extrication: 'Non', extraction: 'Semi rapide', treatments: 'Paracétamol 1 g IV, immobilisation membre supérieur droit.',
      evac_vehicle: 'Ambulance', medicalised: 'Non', hospital: 'CHU de Poitiers', hospital_phone: '05 49 44 44 44', diagnosis: 'Fracture de la clavicule droite suspectée, contusion épaule droite.',
      classification: "2 : transfert à l'hôpital", unfit: 'Non (pas de suspension de licence)', current_event: 'Inapte à reprendre',
      doctor_name: 'Claire Moreau', doctor_phone: '06 11 22 33 44', rpps: '10101234567', comments: 'Revoir à J+7 avant reprise.',
    },
  },
  {
    created_at: '2026-10-04T15:25:00Z',
    data: {
      date: '2026-10-04', time: '11:30', event: 'Trophée de l’Ouest', patient_type: ['Officiel'], patient_last_name: 'Bernard', patient_first_name: 'Julien',
      bp: '125/80', pulse: '84', glasgow: '15', lower_limbs: { Cheville: { Droite: 'E' } }, decision: ['Traitement sur place'],
      classification: '1 : traitement sur place', unfit: 'Non (pas de suspension de licence)', current_event: 'Apte à reprendre', doctor_name: 'Claire Moreau',
    },
  },
];
delete medicalReports[0].data.lower_limbs.Genou;

module.exports = {
  accident,
  medicalReports,
  attachments: [{ source: 'accident', field: 'diagram', filename: 'schema-virage-4.jpg', size_bytes: 482000 }],
};
