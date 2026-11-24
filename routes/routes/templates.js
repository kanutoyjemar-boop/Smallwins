const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const kind = req.query.kind;
  const result = await pool.query(
    `SELECT id, name, kind, items, created_at FROM routine_templates
     WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2)
     ORDER BY created_at DESC`,
    [req.userId, kind || null]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { name, kind, items } = req.body;
  if (!name || !['tasks', 'workouts', 'schedule'].includes(kind) || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'A name, valid routine type, and at least one item are required.' });
  }
  const result = await pool.query(
    `INSERT INTO routine_templates (user_id, name, kind, items)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
    [req.userId, name.trim().slice(0, 100), kind, JSON.stringify(items)]
  );
  res.status(201).json(result.rows[0]);
});

router.post('/:id/apply', async (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'A target date is required.' });
  const result = await pool.query('SELECT * FROM routine_templates WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'Routine not found.' });

  const routine = result.rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of routine.items) {
      if (routine.kind === 'tasks') {
        await client.query('INSERT INTO tasks (user_id, task_date, period, title, points) VALUES ($1, $2, $3, $4, COALESCE($5, 10))', [req.userId, date, item.period, item.title, item.points]);
      } else if (routine.kind === 'workouts') {
        await client.query('INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, points) VALUES ($1, $2, $3, COALESCE($4, 0), $5, COALESCE($6, 20))', [req.userId, date, item.activity_type, item.duration_minutes, item.notes, item.points]);
      } else {
        await client.query('INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes, points) VALUES ($1, $2, $3, $4, $5, COALESCE($6, 30), COALESCE($7, 10))', [req.userId, date, item.title, item.location, item.start_time, item.planned_minutes, item.points]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, count: routine.items.length });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM routine_templates WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;