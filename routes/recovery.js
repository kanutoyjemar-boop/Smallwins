const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey, addDays } = require('../utils/date');
const { isDateKey } = require('../utils/monthly-cashflow');
const { recoveryNextStep } = require('../utils/insights');

const router = express.Router();
router.use(requireAuth);

function dateParam(value) {
  const date = value || todayKey();
  return isDateKey(date) ? date : null;
}

router.get('/week', async (req, res) => {
  const end = dateParam(req.query.date);
  if (!end) return res.status(400).json({ error: 'A valid date is required.' });
  const start = addDays(end, -6);
  const result = await pool.query(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, sleep_hours, sleep_quality, energy, stress
       FROM recovery_checkins
      WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
      ORDER BY entry_date`,
    [req.userId, start, end]
  );
  const rows = result.rows;
  const average = (key) => {
    const values = rows.map((row) => row[key]).filter((value) => value !== null);
    return values.length
      ? Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length * 10) / 10
      : null;
  };
  const summary = {
    start,
    end,
    checkins: rows.length,
    averageSleep: average('sleep_hours'),
    averageQuality: average('sleep_quality'),
    averageEnergy: average('energy'),
    averageStress: average('stress'),
  };
  res.json({ ...summary, coachTip: recoveryNextStep(summary) });
});

router.get('/', async (req, res) => {
  const date = dateParam(req.query.date);
  if (!date) return res.status(400).json({ error: 'A valid date is required.' });
  const result = await pool.query(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, sleep_hours, sleep_quality, energy, stress, note
       FROM recovery_checkins WHERE user_id = $1 AND entry_date = $2`,
    [req.userId, date]
  );
  res.json(result.rows[0] || null);
});

router.put('/', async (req, res) => {
  const { entry_date } = req.body;
  if (!isDateKey(entry_date)) return res.status(400).json({ error: 'A valid date is required.' });

  const numeric = (value) => value === undefined || value === null || value === '' ? null : Number(value);
  const sleepHours = numeric(req.body.sleep_hours);
  const sleepQuality = numeric(req.body.sleep_quality);
  const energy = numeric(req.body.energy);
  const stress = numeric(req.body.stress);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
  if ((sleepHours !== null && (!Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24)) ||
      [sleepQuality, energy, stress].some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) ||
      note.length > 500) {
    return res.status(400).json({ error: 'Use sleep hours from 0 to 24, ratings from 1 to 5, and a note up to 500 characters.' });
  }

  if (sleepHours === null && sleepQuality === null && energy === null && stress === null && !note) {
    await pool.query('DELETE FROM recovery_checkins WHERE user_id = $1 AND entry_date = $2', [req.userId, entry_date]);
    return res.status(204).end();
  }
  const result = await pool.query(
    `INSERT INTO recovery_checkins (user_id, entry_date, sleep_hours, sleep_quality, energy, stress, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, entry_date) DO UPDATE SET
       sleep_hours = EXCLUDED.sleep_hours,
       sleep_quality = EXCLUDED.sleep_quality,
       energy = EXCLUDED.energy,
       stress = EXCLUDED.stress,
       note = EXCLUDED.note,
       updated_at = now()
     RETURNING to_char(entry_date, 'YYYY-MM-DD') AS entry_date, sleep_hours, sleep_quality, energy, stress, note`,
    [req.userId, entry_date, sleepHours, sleepQuality, energy, stress, note]
  );
  res.json(result.rows[0]);
});

module.exports = router;
