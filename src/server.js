'use strict';

const config = require('./config');
const createApp = require('./app');
const migrate = require('./db/migrate');
const reports = require('./services/reports');

async function main() {
  await migrate();
  const app = createApp();
  app.listen(config.port, () => console.log(`${config.appName} – http://localhost:${config.port}`));

  // Relance horaire des médecins n'ayant pas complété leur rapport
  setInterval(() => {
    reports.sendReminders().catch((err) => console.error('Relances :', err));
  }, 60 * 60 * 1000).unref();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
