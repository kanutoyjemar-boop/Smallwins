const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  const result = await pool.query(
    'SELECT * FROM diet_entries WHERE user_id = $1 AND entry_date = $2 ORDER BY id',
    [req.userId, date]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { entry_date, meal_label, food, calories, points } = req.body;
  if (!entry_date || !food) {
    return res.status(400).json({ error: 'Date and food are required.' });
  }
  const result = await pool.query(
    `INSERT INTO diet_entries (user_id, entry_date, meal_label, food, calories, points)
     VALUES ($1, $2, COALESCE($3,'Meal'), $4, $5, COALESCE($6,10)) RETURNING *`,
    [req.userId, entry_date, meal_label, food, calories, points]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { food, meal_label, calories, eaten } = req.body;
  const result = await pool.query(
    `UPDATE diet_entries SET
       food = COALESCE($1, food),
       meal_label = COALESCE($2, meal_label),
       calories = COALESCE($3, calories),
       eaten = COALESCE($4, eaten)
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [food, meal_label, calories, eaten, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Diet entry not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM diet_entries WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
