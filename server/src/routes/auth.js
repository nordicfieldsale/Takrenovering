'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const db = require('../lib/db');
const config = require('../config');
const v = require('../lib/validate');
const { ApiError, signToken, authenticate } = require('../lib/auth');

const router = express.Router();

// Bromsar lösenordsgissning. Räknar per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'För många försök. Vänta en stund och försök igen.' },
});

// Jämförelsehash för konton som inte finns. Genereras vid uppstart så att den
// garanterat är ett giltigt bcrypt-värde — en påhittad sträng kan få
// jämförelsen att kasta fel i stället för att svara "fel lösenord".
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);

const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  email: u.email,
  role: u.role,
  technicianId: u.technician_id ?? null,
});

// ---------------------------------------------------------------------
// POST /api/auth/register – ny säljare, inaktiv tills admin godkänner
// ---------------------------------------------------------------------
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const username = v.username(req.body);
    const password = v.password(req.body);
    const fullName = v.str(req.body, 'fullName', { label: 'Namn', min: 2, max: 120 });
    const email = v.email(req.body, 'email', { required: false });

    const passwordHash = await bcrypt.hash(password, 12);

    let row;
    try {
      const result = await db.query(
        `INSERT INTO users (username, password_hash, full_name, email, role, is_approved)
         VALUES ($1, $2, $3, $4, 'seller', FALSE)
         RETURNING id, username, full_name`,
        [username, passwordHash, fullName, email]
      );
      row = result.rows[0];
    } catch (err) {
      if (err.code === '23505') {
        throw new ApiError(409, 'Användarnamnet eller e-postadressen är redan registrerad.');
      }
      throw err;
    }

    res.status(201).json({
      message: 'Kontot är skapat. En administratör godkänner det innan du kan logga in.',
      user: { id: row.id, username: row.username, fullName: row.full_name },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const usernameRaw = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const passwordRaw = typeof req.body.password === 'string' ? req.body.password : '';
    if (!usernameRaw || !passwordRaw) {
      throw new ApiError(400, 'Fyll i användarnamn och lösenord.');
    }

    const { rows } = await db.query(
      `SELECT u.*, t.id AS technician_id
         FROM users u
         LEFT JOIN technicians t ON t.user_id = u.id
        WHERE lower(u.username) = lower($1)`,
      [usernameRaw]
    );
    const user = rows[0];

    // Jämför alltid mot en hash, även när kontot saknas. Annars går det att
    // lista ut vilka användarnamn som finns genom att mäta svarstiden.
    const hash = user ? user.password_hash : DUMMY_HASH;
    const ok = await bcrypt.compare(passwordRaw, hash);

    if (!user || !ok) throw new ApiError(401, 'Fel användarnamn eller lösenord.');
    if (!user.is_active) throw new ApiError(403, 'Kontot är avstängt. Kontakta administratören.');
    if (!user.is_approved) {
      throw new ApiError(403, 'Kontot väntar på godkännande från administratören.');
    }

    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /api/auth/me – används av appen för att återuppta en session
// ---------------------------------------------------------------------
router.get('/me', authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const current = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const next_ = v.password(req.body, 'newPassword');

    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current, rows[0].password_hash);
    if (!ok) throw new ApiError(401, 'Nuvarande lösenord stämmer inte.');

    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      await bcrypt.hash(next_, 12),
      req.user.id,
    ]);

    res.json({ message: 'Lösenordet är ändrat.' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// POST /api/auth/forgot-password
//   Svarar alltid likadant, oavsett om kontot finns, så att adresser
//   inte går att kartlägga. Länken skickas via e-post när SMTP är kopplat;
//   tills dess loggas den på servern och kan hämtas av admin.
// ---------------------------------------------------------------------
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const identifier = typeof req.body.identifier === 'string' ? req.body.identifier.trim() : '';
    const generic = {
      message: 'Om kontot finns skickas en återställningslänk. Kontakta administratören om du inte får något.',
    };
    if (!identifier) return res.json(generic);

    const { rows } = await db.query(
      `SELECT id, full_name FROM users
        WHERE (lower(username) = lower($1) OR lower(email) = lower($1))
          AND is_active = TRUE`,
      [identifier]
    );
    const user = rows[0];
    if (!user) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [user.id, tokenHash]
    );

    const link = `${config.appUrl}/aterstall?token=${token}`;
    // TODO: skicka via e-post (nodemailer / SendGrid). Loggas tills vidare.
    console.log(`[auth] återställningslänk för ${user.full_name}: ${link}`);

    res.json(config.isProd ? generic : { ...generic, devResetLink: link });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------------
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const newPassword = v.password(req.body, 'newPassword');
    if (!token) throw new ApiError(400, 'Återställningslänken är ofullständig.');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, user_id FROM password_resets
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [tokenHash]
      );
      const reset = rows[0];
      if (!reset) throw new ApiError(400, 'Länken är ogiltig eller har gått ut.');

      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
        await bcrypt.hash(newPassword, 12),
        reset.user_id,
      ]);
      await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
      // Ogiltigförklara övriga utestående länkar för samma konto.
      await client.query(
        'UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
        [reset.user_id]
      );
    });

    res.json({ message: 'Lösenordet är återställt. Du kan logga in nu.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
