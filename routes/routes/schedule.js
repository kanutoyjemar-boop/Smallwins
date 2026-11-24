const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

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
  const { title, location, start_time, planned_minutes, actual_minutes, status } = req.body;
  const result = await pool.query(
    `UPDATE schedule_items SET
       title = COALESCE($1, title),
       location = COALESCE($2, location),
       start_time = COALESCE($3, start_time),
       planned_minutes = COALESCE($4, planned_minutes),
       actual_minutes = COALESCE($5, actual_minutes),
       status = COALESCE($6, status)
     WHERE id = $7 AND user_id = $8 RETURNING *`,
    [title, location, start_time, planned_minutes, actual_minutes, status, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Agenda item not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM schedule_items WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
