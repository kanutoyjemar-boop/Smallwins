const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { date } = req.query;
  const start = date || new Date().toISOString().slice(0, 10);
  const rangeStart = new Date(start + 'T00:00:00');
  rangeStart.setDate(rangeStart.getDate() - 6);
  const startStr = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, '0')}-${String(rangeStart.getDate()).padStart(2, '0')}`;

  const result = await pool.query(
    'SELECT * FROM focus_goals WHERE user_id = $1 AND goal_date BETWEEN $2 AND $3 ORDER BY goal_date, id',
    [req.userId, startStr, start]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { goal_date, title, target, progress, unit } = req.body;
  if (!goal_date || !title) {
    return res.status(400).json({ error: 'Date and goal title are required.' });
  }

  const result = await pool.query(
    `INSERT INTO focus_goals (user_id, goal_date, title, target, progress, unit, completed)
     VALUES ($1, $2, $3, COALESCE($4, 1), COALESCE($5, 0), COALESCE($6, 'times'), COALESCE($7, false))
     RETURNING *`,
    [req.userId, goal_date, title, target, progress, unit, progress >= (target || 1)]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { title, target, progress, unit, completed } = req.body;
  const result = await pool.query(
    `UPDATE focus_goals SET
       title = COALESCE($1, title),
       target = COALESCE($2, target),
       progress = COALESCE($3, progress),
       unit = COALESCE($4, unit),
       completed = COALESCE($5, completed)
     WHERE id = $6 AND user_id = $7 RETURNING *`,
    [title, target, progress, unit, completed, req.params.id, req.userId]
  );

  if (!result.rows.length) return res.status(404).json({ error: 'Goal not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM focus_goals WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
