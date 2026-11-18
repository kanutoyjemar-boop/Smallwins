const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { date } = req.query;
  const key = date || new Date().toISOString().slice(0, 10);
  const result = await pool.query('SELECT * FROM daily_reflections WHERE user_id = $1 AND entry_date = $2', [req.userId, key]);
  res.json(result.rows[0] || null);
});

router.post('/', async (req, res) => {
  const { entry_date, mood, wins, note } = req.body;
  if (!entry_date) return res.status(400).json({ error: 'Date is required.' });

  const result = await pool.query(
    `INSERT INTO daily_reflections (user_id, entry_date, mood, wins, note)
     VALUES ($1, $2, COALESCE($3, 'steady'), $4, $5)
     ON CONFLICT (user_id, entry_date)
     DO UPDATE SET mood = EXCLUDED.mood, wins = EXCLUDED.wins, note = EXCLUDED.note
     RETURNING *`,
    [req.userId, entry_date, mood, wins, note]
  );

  res.status(201).json(result.rows[0]);
});

module.exports = router;
