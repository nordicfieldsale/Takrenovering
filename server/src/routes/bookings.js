'use strict';

const express = require('express');
const db = require('../lib/db');
const v = require('../lib/validate');
const slots = require('../lib/slots');
const { ApiError, authenticate, requireRole } = require('../lib/auth');

const router = express.Router();

const STATUSES = ['new', 'confirmed', 'completed', 'sold', 'cancelled', 'no_show'];

/**
 * Stabil 32-bitars nyckel för en enskild lucka.
 * Används som rådgivande lås så att två samtidiga bokningar av samma
 * tid serialiseras i databasen i stället för att tävla med varandra.
 */
function slotLockKey(technicianId, date, time) {
  const s = `${technicianId}|${date}|${time}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

const shape = (r) => ({
  id: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  address: r.address,
  phone: r.phone,
  date: r.booking_date,
  startTime: r.start_time,
  endTime: r.end_time,
  technicianId: r.technician_id,
  technician: r.technician_name,
  sellerId: r.seller_id,
  seller: r.seller_name,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT_BOOKING = `
  SELECT b.*, t.name AS technician_name
    FROM bookings b
    JOIN technicians t ON t.id = b.technician_id`;

// =====================================================================
// POST /api/bookings – skapa bokning
// =====================================================================
router.post('/', authenticate, requireRole('seller', 'admin'), async (req, res, next) => {
  try {
    const firstName = v.str(req.body, 'firstName', { label: 'Förnamn', min: 2, max: 80 });
    const lastName = v.str(req.body, 'lastName', { label: 'Efternamn', min: 2, max: 80 });
    const address = v.str(req.body, 'address', { label: 'Adress', min: 4, max: 300 });
    const phone = v.phone(req.body);
    const technicianId = v.int(req.body.technicianId, { label: 'Vald person', min: 1 });
    const date = typeof req.body.date === 'string' ? req.body.date : '';
    const startTime = typeof req.body.startTime === 'string' ? req.body.startTime : '';

    // All regelvalidering sker på servern. Frontend kan inte kringgås.
    const slotError = slots.validateSlot(date, startTime);
    if (slotError) throw new ApiError(400, slotError);

    const endTime = slots.endTimeOf(startTime);

    const booking = await db.withTransaction(async (client) => {
      const { rows: techRows } = await client.query(
        'SELECT id, name FROM technicians WHERE id = $1 AND is_active = TRUE',
        [technicianId]
      );
      if (!techRows[0]) throw new ApiError(404, 'Vald person finns inte.');

      // Serialiserar samtidiga försök på exakt samma lucka.
      await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [
        technicianId,
        slotLockKey(technicianId, date, startTime),
      ]);

      const { rows: blockedRows } = await client.query(
        `SELECT 1 FROM blocked_slots
          WHERE technician_id = $1 AND blocked_date = $2 AND start_time = $3`,
        [technicianId, date, startTime]
      );
      if (blockedRows[0]) throw new ApiError(409, 'Tiden är spärrad och går inte att boka.');

      try {
        const { rows } = await client.query(
          `INSERT INTO bookings
             (first_name, last_name, address, phone, booking_date, start_time, end_time,
              technician_id, seller_id, seller_name, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new')
           RETURNING *`,
          [
            firstName, lastName, address, phone, date, startTime, endTime,
            technicianId, req.user.id, req.user.full_name,
          ]
        );
        return { ...rows[0], technician_name: techRows[0].name };
      } catch (err) {
        // Sista skyddsnätet: det partiella unika indexet i databasen.
        if (err.code === '23505') {
          throw new ApiError(409, 'Tiden hann bli bokad. Välj en annan tid.');
        }
        throw err;
      }
    });

    res.status(201).json(shape(booking));
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// GET /api/bookings – rollstyrd lista
//   säljare   -> endast egna bokningar
//   tekniker  -> endast sitt eget schema
//   admin     -> allt, med filter
// =====================================================================
router.get('/', authenticate, async (req, res, next) => {
  try {
    const where = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace('$?', `$${params.length}`));
    };

    if (req.user.role === 'seller') {
      add('b.seller_id = $?', req.user.id);
    } else if (req.user.role === 'technician') {
      if (!req.user.technician_id) throw new ApiError(403, 'Kontot är inte kopplat till någon tekniker.');
      add('b.technician_id = $?', req.user.technician_id);
      add("b.status <> $?", 'cancelled');
    } else if (req.user.role === 'admin') {
      if (req.query.sellerId) add('b.seller_id = $?', v.int(req.query.sellerId, { label: 'Säljare' }));
      if (req.query.technicianId) {
        add('b.technician_id = $?', v.int(req.query.technicianId, { label: 'Person' }));
      }
      if (req.query.status) add('b.status = $?', v.oneOf(req.query.status, STATUSES, 'Status'));
    }

    // Datumfilter gäller alla roller.
    if (req.query.from) {
      if (!slots.isValidDateString(req.query.from)) throw new ApiError(400, 'Ogiltigt startdatum.');
      add('b.booking_date >= $?', req.query.from);
    }
    if (req.query.to) {
      if (!slots.isValidDateString(req.query.to)) throw new ApiError(400, 'Ogiltigt slutdatum.');
      add('b.booking_date <= $?', req.query.to);
    }
    if (req.query.date) {
      if (!slots.isValidDateString(req.query.date)) throw new ApiError(400, 'Ogiltigt datum.');
      add('b.booking_date = $?', req.query.date);
    }

    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await db.query(
      `${SELECT_BOOKING} ${clause}
        ORDER BY b.booking_date DESC, b.start_time DESC
        LIMIT ${limit}`,
      params
    );

    // Interna anteckningar är till för administration. Samma regel som i
    // GET /:id – utan detta följde de med i listan till säljare och tekniker.
    const isAdmin = req.user.role === 'admin';
    res.json(
      rows.map((r) => {
        const item = shape(r);
        if (!isAdmin) delete item.notes;
        return item;
      })
    );
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// GET /api/bookings/summary – säljarens egen statistik
// =====================================================================
router.get('/summary', authenticate, requireRole('seller'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT status, COUNT(*)::int AS count
         FROM bookings WHERE seller_id = $1 GROUP BY status`,
      [req.user.id]
    );

    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    let total = 0;
    for (const r of rows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }

    const { rows: upcoming } = await db.query(
      `SELECT COUNT(*)::int AS count FROM bookings
        WHERE seller_id = $1 AND booking_date >= $2 AND status NOT IN ('cancelled','completed','sold')`,
      [req.user.id, slots.today()]
    );

    res.json({ total, byStatus, upcoming: upcoming[0].count });
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// GET /api/bookings/export.csv – admin
// =====================================================================
router.get('/export.csv', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const params = [];
    const where = [];
    if (req.query.from && slots.isValidDateString(req.query.from)) {
      params.push(req.query.from);
      where.push(`b.booking_date >= $${params.length}`);
    }
    if (req.query.to && slots.isValidDateString(req.query.to)) {
      params.push(req.query.to);
      where.push(`b.booking_date <= $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await db.query(
      `${SELECT_BOOKING} ${clause} ORDER BY b.booking_date DESC, b.start_time DESC`,
      params
    );

    const labels = {
      new: 'Ny bokning', confirmed: 'Bekräftad', completed: 'Genomförd',
      sold: 'Såld', cancelled: 'Avbokad', no_show: 'Ej hemma',
    };

    // Semikolon som avgränsare och BOM först – annars öppnar Excel med
    // svensk lokalisering filen i en enda kolumn och förstör å, ä, ö.
    const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['Datum', 'Starttid', 'Sluttid', 'Förnamn', 'Efternamn', 'Adress',
      'Telefon', 'Utförs av', 'Säljare', 'Status', 'Anteckningar', 'Skapad'];

    const lines = [header.join(';')];
    for (const r of rows) {
      lines.push([
        r.booking_date, r.start_time, r.end_time, r.first_name, r.last_name,
        r.address, r.phone, r.technician_name, r.seller_name,
        labels[r.status] || r.status, r.notes, r.created_at.toISOString(),
      ].map(esc).join(';'));
    }

    const filename = `bokningar-${slots.today()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// GET /api/bookings/:id
// =====================================================================
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Boknings-id', min: 1 });
    const { rows } = await db.query(`${SELECT_BOOKING} WHERE b.id = $1`, [id]);
    const booking = rows[0];
    if (!booking) throw new ApiError(404, 'Bokningen finns inte.');

    if (req.user.role === 'seller' && booking.seller_id !== req.user.id) {
      throw new ApiError(403, 'Du kan bara se dina egna bokningar.');
    }
    if (req.user.role === 'technician' && booking.technician_id !== req.user.technician_id) {
      throw new ApiError(403, 'Du kan bara se ditt eget schema.');
    }

    const result = shape(booking);
    // Interna anteckningar är till för administration och visas inte för säljare.
    if (req.user.role !== 'admin') delete result.notes;

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// =====================================================================
// PATCH /api/bookings/:id – status och interna anteckningar (admin)
// =====================================================================
router.patch('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = v.int(req.params.id, { label: 'Boknings-id', min: 1 });
    const sets = [];
    const params = [];

    if (req.body.status !== undefined) {
      params.push(v.oneOf(req.body.status, STATUSES, 'Status'));
      sets.push(`status = $${params.length}`);
    }
    if (req.body.notes !== undefined) {
      const notes = req.body.notes === null || req.body.notes === ''
        ? null
        : v.str(req.body, 'notes', { label: 'Anteckning', max: 2000, multiline: true });
      params.push(notes);
      sets.push(`notes = $${params.length}`);
    }
    if (sets.length === 0) throw new ApiError(400, 'Inget att uppdatera.');

    params.push(id);

    let rows;
    try {
      ({ rows } = await db.query(
        `UPDATE bookings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
        params
      ));
    } catch (err) {
      // Att återöppna en avbokad tid som någon annan hunnit ta ska ge tydligt svar.
      if (err.code === '23505') {
        throw new ApiError(409, 'Tiden är redan bokad av någon annan och kan inte återöppnas.');
      }
      throw err;
    }
    if (!rows[0]) throw new ApiError(404, 'Bokningen finns inte.');

    const { rows: fresh } = await db.query(`${SELECT_BOOKING} WHERE b.id = $1`, [id]);
    res.json(shape(fresh[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
