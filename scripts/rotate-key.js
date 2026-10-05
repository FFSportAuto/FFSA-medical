'use strict';

// Rotation de la clé de chiffrement : rechiffre avec la clé courante toutes les données
// chiffrées avec une autre clé. Procédure :
//   1. ajouter la nouvelle clé au trousseau : DATA_ENCRYPTION_KEYS="1:<ancienne>,2:<nouvelle>"
//      (la clé la plus récente devient la clé courante) et redémarrer l'application ;
//   2. lancer : npm run rotate-key
//   3. une fois le script terminé (0 donnée restante), retirer l'ancienne clé du trousseau.

const db = require('../src/db');
const config = require('../src/config');
const { encrypt, decrypt, keyIdOf } = require('../src/lib/crypto');

// [table, clé primaire, colonnes chiffrées]
const TARGETS = [
  ['accident_reports', 'id', ['data_enc']],
  ['medical_reports', 'id', ['data_enc']],
  ['medical_requests', 'id', ['doctor_email_enc', 'doctor_phone_enc']],
  ['attachments', 'id', ['filename_enc', 'content_enc']],
  ['case_notes', 'id', ['body_enc']],
  ['drafts', 'owner_key', ['data_enc']],
  ['users', 'id', ['totp_secret_enc']],
];

async function rotate({ log = console.log } = {}) {
  const current = config.encryption.currentId;
  let total = 0;
  for (const [table, pk, columns] of TARGETS) {
    for (const col of columns) {
      const { rows } = await db.query(
        `SELECT ${pk} AS pk, ${col} AS blob FROM ${table} WHERE ${col} IS NOT NULL AND get_byte(${col}, 0) <> $1`,
        [current],
      );
      for (const r of rows) {
        await db.query(`UPDATE ${table} SET ${col} = $2 WHERE ${pk} = $1 AND get_byte(${col}, 0) = $3`, [r.pk, encrypt(decrypt(r.blob)), keyIdOf(r.blob)]);
      }
      if (rows.length) log(`${table}.${col} : ${rows.length} valeur(s) rechiffrée(s)`);
      total += rows.length;
    }
  }
  log(`Rotation terminée : ${total} valeur(s) rechiffrée(s) avec la clé n° ${current}.`);
  return total;
}

module.exports = rotate;

if (require.main === module) {
  rotate()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
