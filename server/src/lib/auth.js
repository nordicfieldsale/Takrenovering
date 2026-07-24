'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('./db');

/** Fel som är säkra att visa för användaren. */
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

/**
 * Verifierar token OCH läser användaren från databasen vid varje anrop.
 * Det gör att ett avstängt eller borttaget konto slutar fungera direkt,
 * i stället för att leva vidare tills token går ut.
 */
async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Du är inte inloggad.', 'NO_TOKEN');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new ApiError(401, 'Sessionen har gått ut. Logga in igen.', 'BAD_TOKEN');
    }

    const { rows } = await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.is_active, u.is_approved,
              t.id AS technician_id
         FROM users u
         LEFT JOIN technicians t ON t.user_id = u.id
        WHERE u.id = $1`,
      [payload.sub]
    );

    const user = rows[0];
    if (!user) throw new ApiError(401, 'Kontot finns inte längre.', 'NO_USER');
    if (!user.is_active) throw new ApiError(403, 'Kontot är avstängt.', 'INACTIVE');
    if (!user.is_approved) {
      throw new ApiError(403, 'Kontot väntar på godkännande.', 'NOT_APPROVED');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Släpper endast igenom angivna roller. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Du är inte inloggad.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'Du har inte behörighet till detta.', 'FORBIDDEN'));
    }
    next();
  };
}

module.exports = { ApiError, signToken, authenticate, requireRole };
