const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const r = await pool.query('SELECT * FROM recurring_tasks WHERE user_id = $1 ORDER BY id', [req.userId]);
  res.json(r.rows);
});

router.post('/', async (req, res) => {
  const { title, period, points, weekdays, start_date } = req.body;
  const days = Array.isArray(weekdays) ? [...new Set(weekdays.map(Number))].filter((d) => d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6];
  if (!title || !String(title).trim() || !['AM', 'PM'].includes(period) || !days.length) {
    return res.status(400).json({ error: 'A title, a period (AM/PM) and at least one weekday are required.' });
  }
  const pts = Math.min(100, Math.max(1, Number(points) || 10));
  const r = await pool.query(
    'INSERT INTO recurring_tasks (user_id, title, period, points, weekdays, start_date) VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, $7::date)) RETURNING *',
    [req.userId, String(title).trim().slice(0, 140), period, pts, days, start_date || null, todayKey()]
  );
  res.status(201).json(r.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM recurring_tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
