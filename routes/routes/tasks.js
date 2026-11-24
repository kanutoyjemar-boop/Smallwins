const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

// GET /api/tasks?date=2026-09-15
router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  const result = await pool.query(
    'SELECT * FROM tasks WHERE user_id = $1 AND task_date = $2 ORDER BY period, id',
    [req.userId, date]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { task_date, period, title, points } = req.body;
  if (!task_date || !period || !title) {
    return res.status(400).json({ error: 'Date, period (AM/PM), and title are required.' });
  }
  const result = await pool.query(
    `INSERT INTO tasks (user_id, task_date, period, title, points)
     VALUES ($1, $2, $3, $4, COALESCE($5, 10)) RETURNING *`,
    [req.userId, task_date, period, title, points]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { title, done, points } = req.body;
  const result = await pool.query(
    `UPDATE tasks SET
       title = COALESCE($1, title),
       done = COALESCE($2, done),
       points = COALESCE($3, points)
     WHERE id = $4 AND user_id = $5 RETURNING *`,
    [title, done, points, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Task not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
