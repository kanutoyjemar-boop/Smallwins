const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  const result = await pool.query(
    'SELECT * FROM workouts WHERE user_id = $1 AND workout_date = $2 ORDER BY id',
    [req.userId, date]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { workout_date, activity_type, duration_minutes, notes, points } = req.body;
  if (!workout_date || !activity_type) {
    return res.status(400).json({ error: 'Date and activity type are required.' });
  }
  const result = await pool.query(
    `INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, points)
     VALUES ($1, $2, $3, COALESCE($4,0), $5, COALESCE($6,20)) RETURNING *`,
    [req.userId, workout_date, activity_type, duration_minutes, notes, points]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { activity_type, duration_minutes, notes, done } = req.body;
  const result = await pool.query(
    `UPDATE workouts SET
       activity_type = COALESCE($1, activity_type),
       duration_minutes = COALESCE($2, duration_minutes),
       notes = COALESCE($3, notes),
       done = COALESCE($4, done)
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [activity_type, duration_minutes, notes, done, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Workout not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM workouts WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
