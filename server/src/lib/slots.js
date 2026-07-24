'use strict';

const { booking } = require('../config');

// =====================================================================
//  Enda källan till sanning för bokningsreglerna.
//  Både backend-validering och kalender-API:t använder dessa funktioner,
//  så frontend och backend kan aldrig glida isär.
// =====================================================================

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Alla starttider en dag, t.ex. 10:00, 11:30, 13:00, 14:30, 16:00, 17:30.
 * En lucka tas bara med om hela besöket ryms innan stängning.
 */
function slotTimes() {
  const open = toMinutes(booking.openTime);
  const close = toMinutes(booking.closeTime);
  const dur = booking.durationMinutes;
  const out = [];
  for (let t = open; t + dur <= close; t += dur) out.push(toHHMM(t));
  return out;
}

const SLOT_TIMES = slotTimes();

function endTimeOf(startHHMM) {
  return toHHMM(toMinutes(startHHMM) + booking.durationMinutes);
}

// ---------------------------------------------------------------------
//  Datum i svensk tidszon.
//  new Date().toISOString() ger UTC och kan hoppa en dag fel på kvällen –
//  därför formateras allt via Intl med den konfigurerade tidszonen.
// ---------------------------------------------------------------------

/** Dagens datum (YYYY-MM-DD) i bokningssystemets tidszon. */
function today() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: booking.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Aktuell klockslag (HH:MM) i bokningssystemets tidszon. */
function nowTime() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: booking.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

/** ISO-veckodag 1–7 (måndag = 1) för ett datum, tidszonsoberoende. */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = söndag
  return day === 0 ? 7 : day;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

function isBookableWeekday(dateStr) {
  return booking.weekdays.includes(weekdayOf(dateStr));
}

/** Sista bokningsbara datumet (idag + horisont). */
function lastBookableDate() {
  return addDays(today(), booking.horizonDays);
}

/** Har luckan redan passerat? */
function isPastSlot(dateStr, startHHMM) {
  const t = today();
  if (dateStr < t) return true;
  if (dateStr > t) return false;
  return startHHMM <= nowTime();
}

/**
 * Validerar en föreslagen bokningstid mot samtliga regler.
 * Returnerar null om allt är korrekt, annars ett felmeddelande.
 */
function validateSlot(dateStr, startHHMM) {
  if (!isValidDateString(dateStr)) return 'Ogiltigt datum.';
  if (typeof startHHMM !== 'string' || !TIME_RE.test(startHHMM)) return 'Ogiltig tid.';
  if (!SLOT_TIMES.includes(startHHMM)) {
    return `Tiden måste vara en av de bokningsbara luckorna: ${SLOT_TIMES.join(', ')}.`;
  }
  if (!isBookableWeekday(dateStr)) return 'Besök kan endast bokas måndag till fredag.';
  if (dateStr < today()) return 'Datumet har passerat.';
  if (dateStr > lastBookableDate()) {
    return `Bokning kan göras högst ${booking.horizonDays} dagar framåt.`;
  }
  if (isPastSlot(dateStr, startHHMM)) return 'Tiden har redan passerat.';
  return null;
}

/** Alla bokningsbara datum i horisonten, exklusive helger. */
function bookableDates() {
  const out = [];
  const start = today();
  for (let i = 0; i <= booking.horizonDays; i++) {
    const d = addDays(start, i);
    if (isBookableWeekday(d)) out.push(d);
  }
  return out;
}

module.exports = {
  SLOT_TIMES,
  DURATION_MINUTES: booking.durationMinutes,
  HORIZON_DAYS: booking.horizonDays,
  endTimeOf,
  today,
  nowTime,
  weekdayOf,
  addDays,
  isValidDateString,
  isBookableWeekday,
  lastBookableDate,
  isPastSlot,
  validateSlot,
  bookableDates,
};
