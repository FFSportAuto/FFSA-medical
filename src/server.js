'use strict';

const config = require('./config');
const createApp = require('./app');
const migrate = require('./db/migrate');
const reports = require('./services/reports');

async function main() {
  // Garde-fou : le mode démo (comptes de test, codes affichés, portail simulé) ne doit jamais
  // tourner sur l'instance de production, sauf instance de démonstration explicitement assumée.
  if (config.isProd && config.demoMode && process.env.ALLOW_DEMO_IN_PRODUCTION !== 'true') {
    throw new Error('DEMO_MODE est interdit en production (NODE_ENV=production). Désactivez-le, ou positionnez ALLOW_DEMO_IN_PRODUCTION=true pour une instance de démonstration sans données réelles.');
  }
  if (config.isProd && !require('./lib/antivirus').isEnabled()) {
    console.warn('ATTENTION : aucun antivirus configuré (CLAMAV_HOST) ; les pièces jointes ne sont pas analysées.');
  }
  await migrate();
  if (config.demoMode) {
    await require('./demo').seed();
    console.log('Mode démonstration actif : comptes de test créés (voir la page de connexion).');
  }
  const app = createApp();
  app.listen(config.port, () => console.log(`${config.appName} – http://localhost:${config.port}`));

  // Relance horaire des médecins n'ayant pas complété leur rapport
  setInterval(() => {
    reports.sendReminders().catch((err) => console.error('Relances :', err));
    reports.purgeDrafts().catch((err) => console.error('Purge des brouillons :', err));
    reports.purgeExpired().catch((err) => console.error('Durée de conservation :', err));
  }, 60 * 60 * 1000).unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
