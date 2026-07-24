'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../lib/db');
const config = require('../config');
const v = require('../lib/validate');
const slots = require('../lib/slots');
const { ApiError, authenticate, requireRole } = require('../lib/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const shapeUser = (u) => ({
  id: u.id,
  username: u.username,
  fullName: u.full_name,
  email: u.email,
  role: u.role,
  isApproved: u.is_approved,
  isActive: u.is_active,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
  bookingCount: u.booking_count ?? 0,
});

// =====================================================================
//  ANVÄNDARE
// =====================================================================

// GET /api/admin/users?pending=1
router.get('/users', async (req, res, next) => {
  try {
    const onlyPending = req.query.pending === '1';
    const { rows } = await db.query(
      `SELECT u.*, COUNT(b.id)::int AS booking_count
         FROM users u
         LEFT JOIN bookings b ON b.seller_id = u.id
        ${onlyPending ? 'WHERE u.is_approved = FALSE' : ''}
        GROUP BY u.id
        ORDER BY u.is_approved ASC, u.full_name ASC`
    );
    res.json(rows.map(shapeUser));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users – skapa konto direkt (säljare, tekniker eller admin)
router.post('/users', async (req, res, next) => {
  try {
    const username = v.username(req.body);
    const password = v.password(req.body);
    const fullName = v.str(req.body, 'fullName', { label: 'Namn', min: 2, max: 120 });
    const email = v.email(req.body, 'email', { required: false });
    const role = v.oneOf(req.body.role, ['seller', 'technician', 'admin'], 'Roll');
    const technicianId = req.body.technicianId
      ? v.int(req.body.technicianId, { label: 'Tekniker', min: 1 })
      : null;

    const user = await db.withTransaction(async (client) => {
      let rows;
      try {
        ({ rows } = await client.query(
          `INSERT INTO users (username, password_hash, full_name, email, role, is_approved, is_active)
           VALUES ($1,$2,$3,$4,$5,TRUE,TRUE) RETURNING *`,
          [username, await bcrypt.hash(password, 12), fullName, email, role]
        ));
      } catch (err) {
        if (err.code === '23505') throw new ApiError(409, 'Användarnamnet eller e-postadressen är upptagen.');
        throw err;
      }

      // Koppla ett teknikerkonto till Karl eller Daniel så att de ser sitt schema.
      if (role === 'technician') {
        if (!technicianId) throw new ApiError(400, 'Välj vilken tekniker kontot gäller.');
        const { rowCount } = await client.query(
          'UPDATE technicians SET user_id = $1 WHERE id = $2',
          [rows[0].id, technicianId]
        );
        if (!rowCount) throw new ApiError(404, 'Teknikern finns inte.');
      }
      return rows[0];
    });

    res.status(201).json(shapeUser(user));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/approve
router.post('/users/:id/approve', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Användar-id', min: 1 });
    const { rows } = await db.query(
      'UPDATE users SET is_approved = TRUE, is_active = TRUE WHERE id = $1 RETURNING *',
      [id]
    );
    if (!rows[0]) throw new ApiError(404, 'Användaren finns inte.');
    res.json(shapeUser(rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/active – stäng av eller slå på ett konto
router.post('/users/:id/active', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Användar-id', min: 1 });
    const isActive = Boolean(req.body.isActive);
    if (id === req.user.id && !isActive) {
      throw new ApiError(400, 'Du kan inte stänga av ditt eget konto.');
    }
    const { rows } = await db.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING *',
      [isActive, id]
    );
    if (!rows[0]) throw new ApiError(404, 'Användaren finns inte.');
    res.json(shapeUser(rows[0]));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id
//   Har kontot bokningar stängs det av i stället för att raderas –
//   annars försvinner historiken bakom bokningarna.
router.delete('/users/:id', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Användar-id', min: 1 });
    if (id === req.user.id) throw new ApiError(400, 'Du kan inte ta bort ditt eget konto.');

    const result = await db.withTransaction(async (client) => {
      const { rows } = await client.query('SELECT id, role FROM users WHERE id = $1', [id]);
      if (!rows[0]) throw new ApiError(404, 'Användaren finns inte.');

      if (rows[0].role === 'admin') {
        const { rows: admins } = await client.query(
          "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE"
        );
        if (admins[0].count <= 1) throw new ApiError(400, 'Det måste finnas minst en aktiv administratör.');
      }

      const { rows: counts } = await client.query(
        'SELECT COUNT(*)::int AS count FROM bookings WHERE seller_id = $1',
        [id]
      );

      if (counts[0].count > 0) {
        await client.query(
          'UPDATE users SET is_active = FALSE, is_approved = FALSE WHERE id = $1',
          [id]
        );
        return { deactivated: true, bookings: counts[0].count };
      }

      await client.query('DELETE FROM users WHERE id = $1', [id]);
      return { deactivated: false };
    });

    res.json(
      result.deactivated
        ? {
            message: `Kontot har ${result.bookings} bokningar och är därför avstängt i stället för raderat. Historiken finns kvar.`,
            deactivated: true,
          }
        : { message: 'Kontot är borttaget.', deactivated: false }
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/reset-link – engångslänk att ge till användaren
router.post('/users/:id/reset-link', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Användar-id', min: 1 });
    const { rows } = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw new ApiError(404, 'Användaren finns inte.');

    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '24 hours')`,
      [id, crypto.createHash('sha256').update(token).digest('hex')]
    );

    res.json({
      link: `${config.appUrl}/aterstall?token=${token}`,
      expiresInHours: 24,
    });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
//  SPÄRRADE TIDER
// =====================================================================

router.get('/blocked-slots', async (req, res, next) => {
  try {
    const from = slots.isValidDateString(req.query.from) ? req.query.from : slots.today();
    const to = slots.isValidDateString(req.query.to) ? req.query.to : slots.lastBookableDate();

    const { rows } = await db.query(
      `SELECT bs.id, bs.technician_id, t.name AS technician, bs.blocked_date, bs.start_time, bs.reason
         FROM blocked_slots bs
         JOIN technicians t ON t.id = bs.technician_id
        WHERE bs.blocked_date BETWEEN $1 AND $2
        ORDER BY bs.blocked_date, bs.start_time`,
      [from, to]
    );

    res.json(
      rows.map((r) => ({
        id: r.id,
        technicianId: r.technician_id,
        technician: r.technician,
        date: r.blocked_date,
        startTime: r.start_time,
        endTime: slots.endTimeOf(r.start_time),
        reason: r.reason,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/blocked-slots', async (req, res, next) => {
  try {
    const technicianId = v.int(req.body.technicianId, { label: 'Person', min: 1 });
    const date = typeof req.body.date === 'string' ? req.body.date : '';
    const startTime = typeof req.body.startTime === 'string' ? req.body.startTime : '';
    const reason = v.str(req.body, 'reason', { label: 'Orsak', max: 200, required: false });

    if (!slots.isValidDateString(date)) throw new ApiError(400, 'Ogiltigt datum.');
    if (!slots.SLOT_TIMES.includes(startTime)) throw new ApiError(400, 'Ogiltig tid.');

    const row = await db.withTransaction(async (client) => {
      const { rows: taken } = await client.query(
        `SELECT 1 FROM bookings
          WHERE technician_id = $1 AND booking_date = $2 AND start_time = $3
            AND status <> 'cancelled'`,
        [technicianId, date, startTime]
      );
      if (taken[0]) throw new ApiError(409, 'Tiden är redan bokad. Avboka bokningen först.');

      try {
        const { rows } = await client.query(
          `INSERT INTO blocked_slots (technician_id, blocked_date, start_time, reason, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [technicianId, date, startTime, reason, req.user.id]
        );
        return rows[0];
      } catch (err) {
        if (err.code === '23505') throw new ApiError(409, 'Tiden är redan spärrad.');
        if (err.code === '23503') throw new ApiError(404, 'Personen finns inte.');
        throw err;
      }
    });

    res.status(201).json({
      id: row.id,
      technicianId: row.technician_id,
      date: row.blocked_date,
      startTime: row.start_time,
      endTime: slots.endTimeOf(row.start_time),
      reason: row.reason,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/blocked-slots/:id', async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Id', min: 1 });
    const { rowCount } = await db.query('DELETE FROM blocked_slots WHERE id = $1', [id]);
    if (!rowCount) throw new ApiError(404, 'Spärren finns inte.');
    res.json({ message: 'Tiden är öppnad igen.' });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
//  STATISTIK
// =====================================================================

router.get('/stats', async (_req, res, next) => {
  try {
    const [totals, bySeller, byTechnician, recent] = await Promise.all([
      db.query(`SELECT status, COUNT(*)::int AS count FROM bookings GROUP BY status`),
      db.query(
        `SELECT u.id, u.full_name,
                COUNT(b.id)::int AS total,
                COUNT(b.id) FILTER (WHERE b.status = 'completed')::int AS completed,
                COUNT(b.id) FILTER (WHERE b.status = 'sold')::int      AS sold,
                COUNT(b.id) FILTER (WHERE b.status = 'no_show')::int   AS no_show
           FROM users u
           LEFT JOIN bookings b ON b.seller_id = u.id
          WHERE u.role = 'seller'
          GROUP BY u.id, u.full_name
          ORDER BY total DESC, u.full_name`
      ),
      db.query(
        `SELECT t.id, t.name, COUNT(b.id)::int AS total
           FROM technicians t
           LEFT JOIN bookings b ON b.technician_id = t.id AND b.status <> 'cancelled'
          GROUP BY t.id, t.name ORDER BY t.sort_order`
      ),
      db.query(
        `SELECT COUNT(*)::int AS count FROM bookings
          WHERE created_at >= now() - interval '30 days'`
      ),
    ]);

    const byStatus = { new: 0, confirmed: 0, completed: 0, sold: 0, cancelled: 0, no_show: 0 };
    let total = 0;
    for (const r of totals.rows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }

    res.json({
      total,
      byStatus,
      last30Days: recent.rows[0].count,
      // Andel av genomförda besök som blev sålda jobb.
      conversionRate:
        byStatus.completed + byStatus.sold > 0
          ? Math.round((byStatus.sold / (byStatus.completed + byStatus.sold)) * 100)
          : 0,
      bySeller: bySeller.rows.map((r) => ({
        id: r.id,
        name: r.full_name,
        total: r.total,
        completed: r.completed,
        sold: r.sold,
        noShow: r.no_show,
      })),
      byTechnician: byTechnician.rows.map((r) => ({ id: r.id, name: r.name, total: r.total })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
