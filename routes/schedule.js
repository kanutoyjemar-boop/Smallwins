const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey, parseDateKey, toDateKey } = require('../utils/date');
const { buildCalendar } = require('../utils/ical');

const router = express.Router();
router.use(requireAuth);

router.get('/export.ics', async (req, res) => {
  const { start, end } = req.query;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isValidDate = (value) => {
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (typeof start !== 'string' || typeof end !== 'string'
    || !isValidDate(start) || !isValidDate(end)
    || start > end
    || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 > 89) {
    return res.status(400).json({ error: 'Provide a valid date range no longer than 90 days.' });
  }
  const result = await pool.query(
    `SELECT id, to_char(item_date, 'YYYY-MM-DD') AS item_date, title, location,
            to_char(start_time, 'HH24:MI:SS') AS start_time, planned_minutes, status
     FROM schedule_items
     WHERE user_id = $1 AND item_date BETWEEN $2 AND $3
     ORDER BY item_date, start_time NULLS LAST, id`,
    [req.userId, start, end]
  );
  const filename = `selfup-agenda-${start}-to-${end}.ics`;
  res.type('text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buildCalendar(result.rows, req.userId));
});

// GET /api/schedule?date=2026-09-15  -> single day
// GET /api/schedule?start=2026-09-15&end=2026-09-18  -> agenda across days (today/tomorrow/next day/etc.)
router.get('/', async (req, res) => {
  const { date, start, end } = req.query;
  let result;
  if (start && end) {
    result = await pool.query(
      'SELECT * FROM schedule_items WHERE user_id = $1 AND item_date BETWEEN $2 AND $3 ORDER BY item_date, start_time NULLS LAST, id',
      [req.userId, start, end]
    );
  } else {
    const d = date || todayKey();
    result = await pool.query(
      'SELECT * FROM schedule_items WHERE user_id = $1 AND item_date = $2 ORDER BY start_time NULLS LAST, id',
      [req.userId, d]
    );
  }
  res.json(result.rows);
});

router.post('/ical-import', async (req, res) => {
  const events = req.body && req.body.events;
  if (!Array.isArray(events) || !events.length || events.length > 200) {
    return res.status(400).json({ error: 'Import between 1 and 200 calendar events at a time.' });
  }
  const prepared = [];
  for (const event of events) {
    const { item_date: date, title, location, start_time: startTime, planned_minutes: plannedMinutes } = event || {};
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(parseDateKey(date)) !== date
      || typeof title !== 'string' || !title.trim() || title.trim().length > 140
      || (location != null && (typeof location !== 'string' || location.length > 200))
      || (startTime != null && (typeof startTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)))
      || !Number.isInteger(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 1440) {
      return res.status(400).json({ error: 'One or more calendar events have invalid date, title, time, or duration values.' });
    }
    prepared.push({
      date,
      title: title.trim(),
      location: location ? location.trim() : null,
      startTime: startTime || null,
      plannedMinutes,
    });
  }
  const dates = prepared.map((event) => event.date).sort();
  if (Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`) > 89 * 86400000) {
    return res.status(400).json({ error: 'Calendar imports must fit within a 90-day range.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let imported = 0;
    let duplicates = 0;
    for (const event of prepared) {
      const result = await client.query(
        `INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes)
         SELECT $1, $2::date, $3, $4, $5::time, $6
         WHERE NOT EXISTS (
           SELECT 1 FROM schedule_items
           WHERE user_id = $1 AND item_date = $2::date AND title = $3
             AND start_time IS NOT DISTINCT FROM $5::time
         )
         RETURNING id`,
        [req.userId, event.date, event.title, event.location, event.startTime, event.plannedMinutes]
      );
      if (result.rowCount) imported += 1;
      else duplicates += 1;
    }
    await client.query('COMMIT');
    res.json({ imported, duplicates });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Calendar import failed and the transaction rollback also failed.');
    }
    throw error;
  } finally {
    client.release();
  }
});

router.post('/', async (req, res) => {
  const { item_date, title, location, start_time, planned_minutes, points } = req.body;
  if (!item_date || !title) return res.status(400).json({ error: 'Date and title are required.' });
  const result = await pool.query(
    `INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes, points)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6,30), COALESCE($7,10)) RETURNING *`,
    [req.userId, item_date, title, location, start_time, planned_minutes, points]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { item_date, title, location, start_time, planned_minutes, actual_minutes, status } = req.body;
  if (item_date !== undefined && (typeof item_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(item_date) || toDateKey(parseDateKey(item_date)) !== item_date)) {
    return res.status(400).json({ error: 'Provide a valid agenda date.' });
  }
  if (status !== undefined && !['pending', 'done', 'overtime', 'skipped'].includes(status)) {
    return res.status(400).json({ error: 'Provide a valid agenda status.' });
  }
  if (actual_minutes !== undefined
    && (!Number.isSafeInteger(actual_minutes) || actual_minutes < 1 || actual_minutes > 2147483647)) {
    return res.status(400).json({ error: 'Actual minutes must be a positive whole number.' });
  }
  if (planned_minutes !== undefined
    && (!Number.isSafeInteger(planned_minutes) || planned_minutes < 1 || planned_minutes > 2147483647)) {
    return res.status(400).json({ error: 'Planned minutes must be a positive whole number.' });
  }
  if ((status === 'done' || status === 'overtime') && actual_minutes === undefined) {
    return res.status(400).json({ error: 'Provide actual minutes when completing an agenda item.' });
  }
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    const currentResult = await client.query(
      'SELECT planned_minutes, actual_minutes, status FROM schedule_items WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.id, req.userId]
    );
    if (!currentResult.rows.length) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(404).json({ error: 'Agenda item not found.' });
    }

    const current = currentResult.rows[0];
    const nextStatus = status === undefined ? current.status : status;
    const nextPlanned = planned_minutes === undefined ? current.planned_minutes : planned_minutes;
    const nextActual = actual_minutes === undefined ? current.actual_minutes : actual_minutes;
    if (['done', 'overtime'].includes(nextStatus)
      && (status !== undefined || planned_minutes !== undefined || actual_minutes !== undefined)
      && (nextActual === null || nextActual === undefined
        || (nextStatus === 'done' && nextActual > nextPlanned)
        || (nextStatus === 'overtime' && nextActual <= nextPlanned))) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return res.status(400).json({
        error: nextStatus === 'done'
          ? 'Actual minutes for a completed item must not exceed planned minutes.'
          : 'Actual minutes for an overtime item must exceed planned minutes.',
      });
    }

    const result = await client.query(
      `UPDATE schedule_items SET
         item_date = COALESCE($1::date, item_date),
         title = COALESCE($2, title),
         location = COALESCE($3, location),
         start_time = COALESCE($4, start_time),
         planned_minutes = COALESCE($5, planned_minutes),
         actual_minutes = CASE
           WHEN COALESCE($7, status) IN ('pending', 'skipped') THEN NULL
           ELSE COALESCE($6, actual_minutes)
         END,
         status = COALESCE($7, status)
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [item_date, title, location, start_time, planned_minutes, actual_minutes, status, req.params.id, req.userId]
    );
    await client.query('COMMIT');
    inTransaction = false;
    res.json(result.rows[0]);
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Agenda update failed and the transaction rollback also failed.');
      }
    }
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM schedule_items WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
