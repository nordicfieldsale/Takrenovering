'use strict';

const express = require('express');
const db = require('../lib/db');
const slots = require('../lib/slots');
const { ApiError, authenticate, requireRole } = require('../lib/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /api/technicians
// ---------------------------------------------------------------------
router.get('/technicians', authenticate, async (_req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name FROM technicians WHERE is_active = TRUE ORDER BY sort_order, name`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /api/availability?technicianId=1
//
//   Denna endpoint är avsiktligt öppen för säljare – det var här det
//   gamla systemet gick sönder: kalendern anropade admin-endpointen och
//   fick 403, så inga tider gråmarkerades och dubbelbokning kunde ske.
//
//   Den returnerar aldrig kunddata, bara ledigt/upptaget per lucka.
// ---------------------------------------------------------------------
router.get(
  '/availability',
  authenticate,
  requireRole('seller', 'admin', 'technician'),
  async (req, res, next) => {
    try {
      const technicianId = Number(req.query.technicianId);
      if (!Number.isInteger(technicianId)) {
        throw new ApiError(400, 'Välj vem som ska utföra besöket.');
      }

      const { rows: techRows } = await db.query(
        'SELECT id, name FROM technicians WHERE id = $1 AND is_active = TRUE',
        [technicianId]
      );
      const technician = techRows[0];
      if (!technician) throw new ApiError(404, 'Teknikern finns inte.');

      const dates = slots.bookableDates();
      if (dates.length === 0) return res.json({ technician, days: [] });

      const from = dates[0];
      const to = dates[dates.length - 1];

      const [{ rows: booked }, { rows: blocked }] = await Promise.all([
        db.query(
          `SELECT booking_date, start_time FROM bookings
            WHERE technician_id = $1
              AND booking_date BETWEEN $2 AND $3
              AND status <> 'cancelled'`,
          [technicianId, from, to]
        ),
        db.query(
          `SELECT blocked_date, start_time FROM blocked_slots
            WHERE technician_id = $1 AND blocked_date BETWEEN $2 AND $3`,
          [technicianId, from, to]
        ),
      ]);

      const bookedKeys = new Set(booked.map((r) => `${r.booking_date}T${r.start_time}`));
      const blockedKeys = new Set(blocked.map((r) => `${r.blocked_date}T${r.start_time}`));

      const days = dates.map((date) => ({
        date,
        weekday: slots.weekdayOf(date),
        slots: slots.SLOT_TIMES.map((start) => {
          const key = `${date}T${start}`;
          let status = 'free';
          if (bookedKeys.has(key)) status = 'booked';
          else if (blockedKeys.has(key)) status = 'blocked';
          else if (slots.isPastSlot(date, start)) status = 'past';
          return { start, end: slots.endTimeOf(start), status };
        }),
      }));

      res.json({
        technician,
        durationMinutes: slots.DURATION_MINUTES,
        horizonDays: slots.HORIZON_DAYS,
        days,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
