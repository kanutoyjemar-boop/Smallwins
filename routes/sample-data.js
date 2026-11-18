const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const trackedTables = new Set([
  'tasks',
  'expenses',
  'workouts',
  'diet_entries',
  'schedule_items',
  'focus_goals',
]);

router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT created_at, jsonb_array_length(records) AS record_count FROM sample_data_sets WHERE user_id = $1',
    [req.userId]
  );
  res.json({
    active: result.rowCount > 0,
    created_at: result.rows[0] ? result.rows[0].created_at : null,
    record_count: result.rows[0] ? Number(result.rows[0].record_count) : 0,
  });
});

router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reservation = await client.query(
      `INSERT INTO sample_data_sets (user_id, records)
       VALUES ($1, '[]'::jsonb)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`,
      [req.userId]
    );
    if (!reservation.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Sample data is already loaded for this account.' });
    }

    const records = [];
    const insert = async (table, sql, values) => {
      const result = await client.query(sql, values);
      records.push({ table, id: result.rows[0].id });
    };

    await insert('tasks',
      `INSERT INTO tasks (user_id, task_date, period, title, done, points)
       VALUES ($1, CURRENT_DATE, 'AM', 'Sample: plan a calm start', true, 10) RETURNING id`,
      [req.userId]);
    await insert('tasks',
      `INSERT INTO tasks (user_id, task_date, period, title, done, points)
       VALUES ($1, CURRENT_DATE - 1, 'PM', 'Sample: prepare for tomorrow', false, 10) RETURNING id`,
      [req.userId]);
    await insert('workouts',
      `INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, done, points)
       VALUES ($1, CURRENT_DATE, 'Walk', 25, 'Sample activity', true, 20) RETURNING id`,
      [req.userId]);
    await insert('diet_entries',
      `INSERT INTO diet_entries (user_id, entry_date, meal_label, food, calories, protein_grams, eaten, points)
       VALUES ($1, CURRENT_DATE, 'Breakfast', 'Sample oatmeal and fruit', 320, 12, true, 10) RETURNING id`,
      [req.userId]);
    await insert('schedule_items',
      `INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes, status, points)
       VALUES ($1, CURRENT_DATE, 'Sample: focused work block', 'Home', '10:00', 45, 'pending', 10) RETURNING id`,
      [req.userId]);
    await insert('focus_goals',
      `INSERT INTO focus_goals (user_id, goal_date, title, target, progress, unit, completed)
       VALUES ($1, CURRENT_DATE, 'Sample: take mindful breaks', 3, 1, 'breaks', false) RETURNING id`,
      [req.userId]);
    await insert('expenses',
      `INSERT INTO expenses (user_id, expense_date, title, category, amount, kind)
       VALUES ($1, CURRENT_DATE, 'Sample: lunch', 'Food', 12.50, 'expense') RETURNING id`,
      [req.userId]);

    await client.query(
      'UPDATE sample_data_sets SET records = $2::jsonb WHERE user_id = $1',
      [req.userId, JSON.stringify(records)]
    );
    await client.query('COMMIT');
    res.status(201).json({ active: true, record_count: records.length });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT records FROM sample_data_sets WHERE user_id = $1 FOR UPDATE',
      [req.userId]
    );
    if (!result.rowCount) {
      await client.query('COMMIT');
      return res.json({ removed: 0 });
    }

    let removed = 0;
    for (const record of result.rows[0].records) {
      if (!record || !trackedTables.has(record.table) || !Number.isInteger(record.id)) continue;
      const deletion = await client.query(
        `DELETE FROM ${record.table} WHERE id = $1 AND user_id = $2`,
        [record.id, req.userId]
      );
      removed += deletion.rowCount;
    }
    await client.query('DELETE FROM sample_data_sets WHERE user_id = $1', [req.userId]);
    await client.query('COMMIT');
    res.json({ removed });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

module.exports = router;
