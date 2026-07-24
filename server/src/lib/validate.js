'use strict';

const { ApiError } = require('./auth');

/**
 * Liten validerare i stället för ett externt schema-bibliotek.
 * Trimmar, normaliserar och kastar ApiError(400) med tydligt fältnamn.
 */

function str(body, field, { label, min = 1, max = 255, required = true, multiline = false } = {}) {
  const name = label || field;
  let value = body[field];
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new ApiError(400, `${name} har fel format.`);
  value = multiline
    ? value.trim().replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ')
    : value.trim().replace(/\s+/g, ' ');
  if (!value) {
    if (required) throw new ApiError(400, `${name} måste fyllas i.`);
    return null;
  }
  if (value.length < min) throw new ApiError(400, `${name} är för kort.`);
  if (value.length > max) throw new ApiError(400, `${name} får vara högst ${max} tecken.`);
  return value;
}

function int(value, { label = 'Värdet', min, max } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ApiError(400, `${label} måste vara ett heltal.`);
  if (min !== undefined && n < min) throw new ApiError(400, `${label} är för litet.`);
  if (max !== undefined && n > max) throw new ApiError(400, `${label} är för stort.`);
  return n;
}

/** Svenska telefonnummer: tillåter mellanslag, bindestreck och +46. */
function phone(body, field = 'phone') {
  const raw = str(body, field, { label: 'Telefonnummer', max: 32 });
  const digits = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d{6,15}$/.test(digits)) {
    throw new ApiError(400, 'Telefonnumret ser inte ut att stämma.');
  }
  return digits;
}

function email(body, field = 'email', { required = false } = {}) {
  const raw = str(body, field, { label: 'E-post', max: 160, required });
  if (!raw) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) {
    throw new ApiError(400, 'E-postadressen ser inte ut att stämma.');
  }
  return raw.toLowerCase();
}

function username(body, field = 'username') {
  const raw = str(body, field, { label: 'Användarnamn', min: 3, max: 64 });
  if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
    throw new ApiError(400, 'Användarnamn får endast innehålla bokstäver, siffror, punkt, bindestreck och understreck.');
  }
  return raw;
}

function password(body, field = 'password') {
  const value = body[field];
  if (typeof value !== 'string' || value.length < 8) {
    throw new ApiError(400, 'Lösenordet måste vara minst 8 tecken.');
  }
  if (value.length > 200) throw new ApiError(400, 'Lösenordet är för långt.');
  return value;
}

function oneOf(value, allowed, label = 'Värdet') {
  if (!allowed.includes(value)) {
    throw new ApiError(400, `${label} måste vara något av: ${allowed.join(', ')}.`);
  }
  return value;
}

module.exports = { str, int, phone, email, username, password, oneOf };
