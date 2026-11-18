const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/selfup_test';
process.env.JWT_SECRET ||= 'body-tracking-test-secret';

const { pool } = require('../db');
const workoutsRouter = require('../routes/workouts');
const dietRouter = require('../routes/diet');

async function withTrackingServer(query, run) {
  const originalQuery = pool.query;
  pool.query = query;
  const app = express();
  app.use(express.json());
  app.use('/api/workouts', workoutsRouter);
  app.use('/api/diet', dietRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const token = jwt.sign({ userId: 42, tokenVersion: 0 }, process.env.JWT_SECRET);
  try {
    await run(`http://127.0.0.1:${server.address().port}`, token);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    pool.query = originalQuery;
  }
}

test('workout and diet APIs persist movement details and protein with validation', async () => {
  const calls = [];
  await withTrackingServer(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT token_version')) return { rows: [{ token_version: 0 }] };
    if (sql.startsWith('INSERT INTO workouts')) {
      return { rows: [{ activity_type: params[2], training_split: params[5] ?? null, distance_km: params[6], steps: params[7], exercises: JSON.parse(params[8]) }] };
    }
    if (sql.startsWith('INSERT INTO diet_entries')) {
      return { rows: [{ food: params[3], protein_grams: params[5] }] };
    }
    if (sql.startsWith('UPDATE workouts')) return { rows: [{ id: params[11] }] };
    if (sql.startsWith('UPDATE diet_entries')) return { rows: [{ id: params[6] }] };
    throw new Error(`Unexpected query: ${sql}`);
  }, async (url, token) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const workout = await fetch(`${url}/api/workouts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workout_date: '2026-11-11',
        activity_type: 'Running (Cardio)',
        duration_minutes: 30,
        distance_km: 4.5,
        steps: 6200,
      }),
    });
    assert.equal(workout.status, 201);
    assert.deepEqual(await workout.json(), {
      activity_type: 'Running (Cardio)',
      training_split: null,
      distance_km: 4.5,
      steps: 6200,
      exercises: [],
    });

    const gymSession = await fetch(`${url}/api/workouts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workout_date: '2026-11-11',
        activity_type: 'Gym (Strength)',
        training_split: 'Push',
        exercises: [{ name: 'Bench press', sets: 3, reps: 8, weight_kg: 40 }],
      }),
    });
    assert.equal(gymSession.status, 201);
    assert.deepEqual((await gymSession.json()).exercises, [
      { name: 'Bench press', sets: 3, reps: 8, weight_kg: 40 },
    ]);

    const invalidWorkout = await fetch(`${url}/api/workouts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workout_date: '2026-11-11',
        activity_type: 'Running (Cardio)',
        steps: 2.5,
      }),
    });
    assert.equal(invalidWorkout.status, 400);
    const invalidExercise = await fetch(`${url}/api/workouts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workout_date: '2026-11-11',
        activity_type: 'Gym (Strength)',
        exercises: [{ name: 'Bench press', sets: 0, reps: 8 }],
      }),
    });
    assert.equal(invalidExercise.status, 400);

    const meal = await fetch(`${url}/api/diet`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        entry_date: '2026-11-11',
        food: 'Chicken breast, skinless (cooked)',
        protein_grams: 46.5,
      }),
    });
    assert.equal(meal.status, 201);
    assert.deepEqual(await meal.json(), {
      food: 'Chicken breast, skinless (cooked)',
      protein_grams: 46.5,
    });

    const invalidMeal = await fetch(`${url}/api/diet`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ entry_date: '2026-11-11', food: 'Chicken', protein_grams: -1 }),
    });
    assert.equal(invalidMeal.status, 400);

    const clearWorkoutMetrics = await fetch(`${url}/api/workouts/8`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ distance_km: null, steps: null }),
    });
    assert.equal(clearWorkoutMetrics.status, 200);
    const workoutUpdate = calls.find((call) => call.sql.startsWith('UPDATE workouts'));
    assert.equal(workoutUpdate.params[4], true);
    assert.equal(workoutUpdate.params[5], null);
    assert.equal(workoutUpdate.params[6], true);
    assert.equal(workoutUpdate.params[7], null);

    const clearExercises = await fetch(`${url}/api/workouts/8`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ exercises: [] }),
    });
    assert.equal(clearExercises.status, 200);
    const workoutExerciseUpdate = calls.filter((call) => call.sql.startsWith('UPDATE workouts'))[1];
    assert.equal(workoutExerciseUpdate.params[8], true);
    assert.equal(workoutExerciseUpdate.params[9], '[]');

    const clearMealProtein = await fetch(`${url}/api/diet/9`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ protein_grams: null }),
    });
    assert.equal(clearMealProtein.status, 200);
    const dietUpdate = calls.find((call) => call.sql.startsWith('UPDATE diet_entries'));
    assert.equal(dietUpdate.params[3], true);
    assert.equal(dietUpdate.params[4], null);
    assert.equal(calls.filter((call) => call.sql.startsWith('INSERT INTO workouts')).length, 2);
    assert.equal(calls.filter((call) => call.sql.startsWith('INSERT INTO diet_entries')).length, 1);
  });
});
