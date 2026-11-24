const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');
const { normalizeBackup } = require('../utils/backup');

const router = express.Router();
router.use(requireAuth);

// GET /api/export -> every row the user has ever logged, as one JSON file.
// Meant for personal backup/portability, not as a general-purpose API.
// Dates are formatted in SQL (YYYY-MM-DD) so they never shift with the
// server's timezone.
router.get('/', async (req, res) => {
  const userId = req.userId;
  const D = (col) => `to_char(${col}, 'YYYY-MM-DD')`;
  const [user, tasks, expenses, budgets, workouts, diet, schedule, goals, reflections, routines, milestones] = await Promise.all([
    pool.query('SELECT id, name, email, created_at FROM users WHERE id = $1', [userId]),
    pool.query(`SELECT ${D('task_date')} AS task_date, period, title, done, points FROM tasks WHERE user_id = $1 ORDER BY tasks.task_date, period, id`, [userId]),
    pool.query(`SELECT ${D('expense_date')} AS expense_date, title, category, amount, kind FROM expenses WHERE user_id = $1 ORDER BY expenses.expense_date, id`, [userId]),
    pool.query(`SELECT ${D('budget_date')} AS budget_date, daily_limit FROM budgets WHERE user_id = $1 ORDER BY budgets.budget_date`, [userId]),
    pool.query(`SELECT ${D('workout_date')} AS workout_date, activity_type, duration_minutes, notes, done, points FROM workouts WHERE user_id = $1 ORDER BY workouts.workout_date, id`, [userId]),
    pool.query(`SELECT ${D('entry_date')} AS entry_date, meal_label, food, calories, eaten, points FROM diet_entries WHERE user_id = $1 ORDER BY diet_entries.entry_date, id`, [userId]),
    pool.query(`SELECT ${D('item_date')} AS item_date, title, location, to_char(start_time, 'HH24:MI') AS start_time, planned_minutes, actual_minutes, status, points FROM schedule_items WHERE user_id = $1 ORDER BY schedule_items.item_date, id`, [userId]),
    pool.query(`SELECT ${D('goal_date')} AS goal_date, title, target, progress, unit, completed FROM focus_goals WHERE user_id = $1 ORDER BY focus_goals.goal_date, id`, [userId]),
    pool.query(`SELECT ${D('entry_date')} AS entry_date, mood, wins, note FROM daily_reflections WHERE user_id = $1 ORDER BY daily_reflections.entry_date`, [userId]),
    pool.query('SELECT name, kind, items FROM routine_templates WHERE user_id = $1 ORDER BY id', [userId]),
    pool.query('SELECT milestone_key, label, achieved_at FROM achievement_milestones WHERE user_id = $1 ORDER BY achieved_at', [userId]),
  ]);

  res.setHeader('Content-Disposition', `attachment; filename="selfup-export-${todayKey()}.json"`);
  res.json({
    version: 2,
    exported_at: new Date().toISOString(),
    account: user.rows[0],
    tasks: tasks.rows,
    expenses: expenses.rows,
    budgets: budgets.rows,
    workouts: workouts.rows,
    diet: diet.rows,
    schedule: schedule.rows,
    goals: goals.rows,
    reflections: reflections.rows,
    routines: routines.rows,
    milestones: milestones.rows,
  });
});

// Each insert is skipped when an identical row already exists, so importing
// the same backup twice (or an old backup over newer data) never duplicates.
const INSERTS = {
  tasks: ['INSERT INTO tasks (user_id, task_date, period, title, done, points) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE user_id=$1 AND task_date=$2 AND period=$3 AND title=$4)', (r) => [r.task_date, r.period, r.title, r.done, r.points]],
  expenses: ['INSERT INTO expenses (user_id, expense_date, title, category, amount, kind) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE user_id=$1 AND expense_date=$2 AND title=$3 AND amount=$5 AND kind=$6)', (r) => [r.expense_date, r.title, r.category, r.amount, r.kind]],
  budgets: ['INSERT INTO budgets (user_id, budget_date, daily_limit) VALUES ($1,$2,$3) ON CONFLICT (user_id, budget_date) DO NOTHING', (r) => [r.budget_date, r.daily_limit]],
  workouts: ['INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, done, points) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM workouts WHERE user_id=$1 AND workout_date=$2 AND activity_type=$3 AND duration_minutes=$4)', (r) => [r.workout_date, r.activity_type, r.duration_minutes, r.notes, r.done, r.points]],
  diet: ['INSERT INTO diet_entries (user_id, entry_date, meal_label, food, calories, eaten, points) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM diet_entries WHERE user_id=$1 AND entry_date=$2 AND meal_label=$3 AND food=$4)', (r) => [r.entry_date, r.meal_label, r.food, r.calories, r.eaten, r.points]],
  schedule: ['INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes, actual_minutes, status, points) SELECT $1,$2,$3,$4,$5::time,$6,$7,$8,$9 WHERE NOT EXISTS (SELECT 1 FROM schedule_items WHERE user_id=$1 AND item_date=$2 AND title=$3 AND start_time IS NOT DISTINCT FROM $5::time)', (r) => [r.item_date, r.title, r.location, r.start_time, r.planned_minutes, r.actual_minutes, r.status, r.points]],
  goals: ['INSERT INTO focus_goals (user_id, goal_date, title, target, progress, unit, completed) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM focus_goals WHERE user_id=$1 AND goal_date=$2 AND title=$3)', (r) => [r.goal_date, r.title, r.target, r.progress, r.unit, r.completed]],
  reflections: ['INSERT INTO daily_reflections (user_id, entry_date, mood, wins, note) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, entry_date) DO NOTHING', (r) => [r.entry_date, r.mood, r.wins, r.note]],
  routines: ['INSERT INTO routine_templates (user_id, name, kind, items) SELECT $1,$2,$3,$4::jsonb WHERE NOT EXISTS (SELECT 1 FROM routine_templates WHERE user_id=$1 AND name=$2 AND kind=$3)', (r) => [r.name, r.kind, JSON.stringify(r.items)]],
  milestones: ['INSERT INTO achievement_milestones (user_id, milestone_key, label, achieved_at) VALUES ($1,$2,$3,COALESCE($4::timestamptz, now())) ON CONFLICT (user_id, milestone_key) DO NOTHING', (r) => [r.milestone_key, r.label, r.achieved_at]],
};

// POST /api/export/import -> validate, then merge a SelfUp backup into this
// account in a single transaction. Existing entries are never changed.
router.post('/import', async (req, res) => {
  const { data, accepted, skipped } = normalizeBackup(req.body);
  if (!accepted) {
    return res.status(400).json({ error: 'Nothing to import. Check that this is a valid SelfUp export file.' });
  }

  const client = await pool.connect();
  let added = 0;
  try {
    await client.query('BEGIN');
    for (const [section, [sql, toParams]] of Object.entries(INSERTS)) {
      for (const row of data[section]) {
        const r = await client.query(sql, [req.userId, ...toParams(row)]);
        added += r.rowCount;
      }
    }
    await client.query('COMMIT');
    res.status(201).json({
      ok: true,
      added,
      duplicates: accepted - added,
      skipped,
      message: `Backup merged: ${added} added, ${accepted - added} already existed${skipped ? `, ${skipped} invalid skipped` : ''}.`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import failed:', error);
    res.status(400).json({ error: 'Import failed. Check that this is a valid SelfUp export file.' });
  } finally {
    client.release();
  }
});

module.exports = router;
