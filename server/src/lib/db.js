'use strict';

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
});

// En pool-klient kan dö i bakgrunden (nätverk, omstart av databasen).
// Utan denna lyssnare kraschar hela processen på ett ohanterat fel.
pool.on('error', (err) => {
  console.error('[db] oväntat fel på inaktiv klient:', err.message);
});

// DATE kommer annars tillbaka som JS-Date och blir fel dag vid tidszonskonvertering.
// Vi vill ha råsträngen 'YYYY-MM-DD' hela vägen ut till klienten.
const { types } = require('pg');
types.setTypeParser(1082, (value) => value); // date
types.setTypeParser(1083, (value) => (value ? value.slice(0, 5) : value)); // time -> HH:MM

async function query(text, params) {
  return pool.query(text, params);
}

/** Kör en callback inuti en transaktion och rullar tillbaka vid fel. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback misslyckades:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
