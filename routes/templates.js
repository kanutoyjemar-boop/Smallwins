const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { addDays, parseDateKey, toDateKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

function validPoints(value) {
  return value == null || (Number.isInteger(value) && value >= 0);
}

function validOptionalNumber(value, integer = false) {
  return value == null ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
      (integer ? Number.isInteger(value) && value <= 1000000 : value <= 999999.99));
}

function validExercises(exercises) {
  return exercises == null || (
    Array.isArray(exercises) && exercises.length <= 30 &&
    exercises.every((exercise) => exercise && typeof exercise === 'object' && !Array.isArray(exercise) &&
      typeof exercise.name === 'string' && exercise.name.trim().length > 0 && exercise.name.length <= 80 &&
      Number.isInteger(exercise.sets) && exercise.sets >= 1 && exercise.sets <= 100 &&
      Number.isInteger(exercise.reps) && exercise.reps >= 1 && exercise.reps <= 1000 &&
      (exercise.weight_kg == null || (typeof exercise.weight_kg === 'number' && Number.isFinite(exercise.weight_kg) && exercise.weight_kg >= 0 && exercise.weight_kg <= 1000))
    )
  );
}

function validRoutineItem(kind, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (kind === 'tasks') {
    return ['AM', 'PM'].includes(item.period) && typeof item.title === 'string' &&
      Boolean(item.title.trim()) && validPoints(item.points);
  }
  if (kind === 'workouts') {
    return typeof item.activity_type === 'string' && Boolean(item.activity_type.trim()) &&
      (item.duration_minutes == null || (Number.isInteger(item.duration_minutes) && item.duration_minutes >= 0)) &&
      (item.notes == null || typeof item.notes === 'string') &&
      (item.training_split == null || (typeof item.training_split === 'string' && item.training_split.length <= 40)) &&
      validOptionalNumber(item.distance_km) && validOptionalNumber(item.steps, true) &&
      validExercises(item.exercises) && validPoints(item.points);
  }
  if (kind === 'schedule') {
    const timeIsValid = item.start_time == null ||
      (typeof item.start_time === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(item.start_time) && Number(item.start_time.slice(0, 2)) < 24 &&
        Number(item.start_time.slice(3, 5)) < 60 && Number((item.start_time.split(':')[2] || '0')) < 60);
    return typeof item.title === 'string' && Boolean(item.title.trim()) && timeIsValid &&
      (item.location == null || typeof item.location === 'string') &&
      (item.planned_minutes == null || (Number.isInteger(item.planned_minutes) && item.planned_minutes > 0)) &&
      validPoints(item.points);
  }
  return false;
}

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
  if (!items.every((item) => validRoutineItem(kind, item))) {
    return res.status(400).json({ error: 'The routine contains an invalid item.' });
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
  if (!Array.isArray(routine.items) || !routine.items.every((item) => validRoutineItem(routine.kind, item))) {
    return res.status(400).json({ error: 'This routine contains an invalid item.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of routine.items) {
      if (routine.kind === 'tasks') {
        await client.query('INSERT INTO tasks (user_id, task_date, period, title, points) VALUES ($1, $2, $3, $4, COALESCE($5, 10))', [req.userId, date, item.period, item.title, item.points]);
      } else if (routine.kind === 'workouts') {
        await client.query(
          `INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, points)
           VALUES ($1, $2, $3, COALESCE($4, 0), $5, $6, $7, $8, $9::jsonb, COALESCE($10, 20))`,
          [req.userId, date, item.activity_type, item.duration_minutes, item.notes, item.training_split, item.distance_km, item.steps, JSON.stringify(item.exercises || []), item.points]
        );
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

router.post('/:id/apply-week', async (req, res) => {
  const { week_start: weekStart, weekdays } = req.body || {};
  if (
    typeof weekStart !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
    toDateKey(parseDateKey(weekStart)) !== weekStart ||
    parseDateKey(weekStart).getDay() !== 1
  ) {
    return res.status(400).json({ error: 'Choose a valid Monday as the week start.' });
  }
  if (
    !Array.isArray(weekdays) ||
    !weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    return res.status(400).json({ error: 'Choose one or more distinct weekdays.' });
  }

  const result = await pool.query(
    'SELECT * FROM routine_templates WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Routine not found.' });
  const routine = result.rows[0];
  if (!Array.isArray(routine.items) || routine.items.length > 100) {
    return res.status(400).json({ error: 'This routine cannot be planned for a week.' });
  }
  if (!routine.items.every((item) => validRoutineItem(routine.kind, item))) {
    return res.status(400).json({ error: 'This routine contains an invalid item. Edit or replace it before planning the week.' });
  }

  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const weekday of weekdays) {
      const date = addDays(weekStart, weekday === 0 ? 6 : weekday - 1);
      for (const item of routine.items) {
        let query;
        let values;
        if (routine.kind === 'tasks') {
          query = `INSERT INTO tasks (user_id, task_date, period, title, points)
                   SELECT $1, $2, $3, $4, COALESCE($5, 10)
                   WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE user_id=$1 AND task_date=$2 AND period=$3 AND title=$4)`;
          values = [req.userId, date, item.period, item.title.trim().slice(0, 140), item.points];
        } else if (routine.kind === 'workouts') {
          const duration = Number(item.duration_minutes || 0);
          query = `INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, points)
                   SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, COALESCE($10, 20)
                   WHERE NOT EXISTS (
                     SELECT 1 FROM workouts
                     WHERE user_id=$1 AND workout_date=$2 AND activity_type=$3 AND duration_minutes=$4
                       AND training_split IS NOT DISTINCT FROM $6::text
                       AND distance_km IS NOT DISTINCT FROM $7::numeric
                       AND steps IS NOT DISTINCT FROM $8::integer
                       AND exercises IS NOT DISTINCT FROM $9::jsonb
                   )`;
          values = [req.userId, date, item.activity_type.trim().slice(0, 80), duration, item.notes || null, item.training_split || null, item.distance_km ?? null, item.steps ?? null, JSON.stringify(item.exercises || []), item.points];
        } else if (routine.kind === 'schedule') {
          query = `INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes, points)
                   SELECT $1, $2, $3, $4, $5, COALESCE($6, 30), COALESCE($7, 10)
                   WHERE NOT EXISTS (SELECT 1 FROM schedule_items WHERE user_id=$1 AND item_date=$2 AND title=$3 AND start_time IS NOT DISTINCT FROM $5::time)`;
          values = [req.userId, date, item.title.trim().slice(0, 140), item.location || null, item.start_time || null, item.planned_minutes, item.points];
        } else throw new Error('This routine has an unsupported type.');
        count += (await client.query(query, values)).rowCount;
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, count });
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