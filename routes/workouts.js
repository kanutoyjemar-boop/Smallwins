const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

function validOptionalNumber(value, integer = false) {
  return value == null || value === '' ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
      (integer ? Number.isInteger(value) && value <= 1000000 : value <= 999999.99));
}

function validTrainingSplit(value) {
  return value == null || (typeof value === 'string' && value.length <= 40);
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

router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  const result = await pool.query(
    'SELECT * FROM workouts WHERE user_id = $1 AND workout_date = $2 ORDER BY id',
    [req.userId, date]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, points } = req.body;
  if (!workout_date || !activity_type) {
    return res.status(400).json({ error: 'Date and activity type are required.' });
  }
  if (!validTrainingSplit(training_split) || !validOptionalNumber(distance_km) || !validOptionalNumber(steps, true) || !validExercises(exercises)) {
    return res.status(400).json({ error: 'Workout details contain an invalid split, distance, step count, or exercise.' });
  }
  const result = await pool.query(
    `INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, points)
     VALUES ($1, $2, $3, COALESCE($4,0), $5, $6, $7, $8, $9::jsonb, COALESCE($10,20)) RETURNING *`,
    [req.userId, workout_date, activity_type, duration_minutes, notes, training_split, distance_km === '' ? null : distance_km, steps === '' ? null : steps, JSON.stringify(exercises || []), points]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, done } = req.body;
  if (!validTrainingSplit(training_split) || !validOptionalNumber(distance_km) || !validOptionalNumber(steps, true) || !validExercises(exercises)) {
    return res.status(400).json({ error: 'Workout details contain an invalid split, distance, step count, or exercise.' });
  }
  const hasDistance = Object.prototype.hasOwnProperty.call(req.body, 'distance_km');
  const hasSteps = Object.prototype.hasOwnProperty.call(req.body, 'steps');
  const hasExercises = Object.prototype.hasOwnProperty.call(req.body, 'exercises');
  const result = await pool.query(
    `UPDATE workouts SET
       activity_type = COALESCE($1, activity_type),
       duration_minutes = COALESCE($2, duration_minutes),
       notes = COALESCE($3, notes),
       training_split = COALESCE($4, training_split),
       distance_km = CASE WHEN $5 THEN $6::numeric ELSE distance_km END,
       steps = CASE WHEN $7 THEN $8::integer ELSE steps END,
       exercises = CASE WHEN $9 THEN $10::jsonb ELSE exercises END,
       done = COALESCE($11, done)
     WHERE id = $12 AND user_id = $13 RETURNING *`,
    [activity_type, duration_minutes, notes, training_split, hasDistance, distance_km === '' ? null : distance_km, hasSteps, steps === '' ? null : steps, hasExercises, JSON.stringify(exercises || []), done, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Workout not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM workouts WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
