'use strict';

// Création d'un compte en ligne de commande (ex. premier administrateur) :
//   npm run create-user -- admin@ffsa.org "Prénom Nom" admin
// Un lien d'activation est envoyé par e-mail (ou écrit dans ./outbox en développement).

const db = require('../src/db');
const migrate = require('../src/db/migrate');
const mailer = require('../src/lib/mailer');
const config = require('../src/config');
const { randomToken, hashToken } = require('../src/lib/crypto');

async function main() {
  const [email, fullName, role = 'admin'] = process.argv.slice(2);
  if (!email || !fullName || !['organizer', 'medical', 'admin'].includes(role)) {
    console.error('Usage : npm run create-user -- <email> "<Nom complet>" <organizer|medical|admin>');
    process.exit(1);
  }
  await migrate();
  const user = await db.one(
    'INSERT INTO users (email, full_name, role) VALUES ($1, $2, $3) RETURNING id',
    [email.toLowerCase(), fullName, role],
  );
  const token = randomToken();
  await db.query(
    `INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, 'invite', $2, now() + interval '72 hours')`,
    [user.id, hashToken(token)],
  );
  const link = `${config.baseUrl}/mot-de-passe/${token}`;
  await mailer.send('userInvitation', email, { name: fullName, role, link });
  console.log(`Compte créé. Lien d'activation (72 h) : ${link}`);
  await db.pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
