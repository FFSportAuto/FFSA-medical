'use strict';

const fs = require('fs');
const path = require('path');
const db = require('./index');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);
}

module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration terminée.');
      return db.pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
