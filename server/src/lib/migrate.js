'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

/**
 * Körs automatiskt varje gång servern startar.
 * Schemat är idempotent, så det är säkert att köra om vid varje omstart
 * och ingen manuell psql-körning behövs vid installation.
 */
async function migrate() {
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await db.query(sql);
  console.log('[migrate] databasschemat är uppdaterat');
}

/**
 * Skapar det första administratörskontot från miljövariabler.
 * Görs bara om det inte redan finns någon administratör – ett befintligt
 * lösenord skrivs aldrig över vid omstart.
 */
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME || 'Administratör';

  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'"
  );
  if (rows[0].count > 0) return;

  if (!username || !password) {
    console.warn(
      '[seed] Ingen administratör finns och ADMIN_USERNAME/ADMIN_PASSWORD saknas. ' +
        'Sätt dem i .env och starta om.'
    );
    return;
  }
  if (password.length < 10) {
    throw new Error('ADMIN_PASSWORD måste vara minst 10 tecken.');
  }

  await db.query(
    `INSERT INTO users (username, password_hash, full_name, email, role, is_approved, is_active)
     VALUES ($1, $2, $3, $4, 'admin', TRUE, TRUE)`,
    [username, await bcrypt.hash(password, 12), fullName, process.env.ADMIN_EMAIL || null]
  );

  console.log(`[seed] administratörskonto skapat: ${username}`);
}

/** Väntar in databasen – containern kan starta före PostgreSQL är redo. */
async function waitForDatabase({ attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[db] väntar på databasen (${i}/${attempts})…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { migrate, seedAdmin, waitForDatabase };
