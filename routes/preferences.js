const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const KEYS = ['tasks', 'workouts', 'diet', 'schedule', 'money'];
const DEFAULTS = { tasks: 1, workouts: 1, diet: 1, schedule: 1, money: 1 };

router.get('/scoring', async (req, res) => {
  const result = await pool.query(
    'SELECT tasks, workouts, diet, schedule, money FROM scoring_preferences WHERE user_id = $1',
    [req.userId]
  );
  res.json(result.rows[0] || DEFAULTS);
});

router.put('/scoring', async (req, res) => {
  const preferences = req.body || {};
  const values = KEYS.map((key) => preferences[key]);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 3)) {
    return res.status(400).json({ error: 'Choose a whole-number priority from 0 to 3 for each area.' });
  }
  if (values.every((value) => value === 0)) {
    return res.status(400).json({ error: 'At least one area must be included in your score.' });
  }

  const result = await pool.query(
    `INSERT INTO scoring_preferences (user_id, tasks, workouts, diet, schedule, money)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       tasks = EXCLUDED.tasks, workouts = EXCLUDED.workouts, diet = EXCLUDED.diet,
       schedule = EXCLUDED.schedule, money = EXCLUDED.money, updated_at = now()
     RETURNING tasks, workouts, diet, schedule, money`,
    [req.userId, ...values]
  );
  res.json(result.rows[0]);
});

module.exports = router;
