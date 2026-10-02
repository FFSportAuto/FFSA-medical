'use strict';

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  async one(text, params) {
    const { rows } = await pool.query(text, params);
    return rows[0] || null;
  },
  async tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
