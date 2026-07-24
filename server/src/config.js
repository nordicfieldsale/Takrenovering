'use strict';

// .env läses vid lokal körning. I containern kommer variablerna från
// docker compose, och då behövs ingen fil – därför är detta inte kritiskt.
try {
  require('dotenv').config();
} catch {
  /* dotenv saknas – miljövariabler sätts av driftmiljön */
}

const isProd = process.env.NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) {
    // Hellre krascha vid uppstart än att gå live med en osäker standard.
    throw new Error(`Miljövariabeln ${name} saknas. Se .env.example.`);
  }
  return value;
}

const jwtSecret = process.env.JWT_SECRET;
if (isProd && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET måste vara minst 32 tecken i produktion.');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT || 5000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: jwtSecret || 'dev-only-secret-byt-innan-produktion',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',

  // Kommaseparerad lista, t.ex. "https://bokning.villatakrenovering.se"
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Publik adress till webbappen – används i återställningslänkar.
  appUrl: process.env.APP_URL || 'http://localhost:5173',

  // Bokningsregler. Ligger här så att de kan justeras utan kodändring.
  booking: {
    timezone: process.env.BOOKING_TIMEZONE || 'Europe/Stockholm',
    openTime: process.env.BOOKING_OPEN || '10:00',
    closeTime: process.env.BOOKING_CLOSE || '20:00',
    durationMinutes: Number(process.env.BOOKING_DURATION_MINUTES || 90),
    horizonDays: Number(process.env.BOOKING_HORIZON_DAYS || 14),
    weekdays: [1, 2, 3, 4, 5], // måndag–fredag
  },
};
