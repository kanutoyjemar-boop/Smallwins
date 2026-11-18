const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

function validProtein(value) {
  return value == null || value === '' ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000);
}

router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  const result = await pool.query(
    'SELECT * FROM diet_entries WHERE user_id = $1 AND entry_date = $2 ORDER BY id',
    [req.userId, date]
  );
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { entry_date, meal_label, food, calories, protein_grams, points } = req.body;
  if (!entry_date || !food) {
    return res.status(400).json({ error: 'Date and food are required.' });
  }
  if (!validProtein(protein_grams)) {
    return res.status(400).json({ error: 'Protein must be between 0 and 1,000 grams.' });
  }
  const result = await pool.query(
    `INSERT INTO diet_entries (user_id, entry_date, meal_label, food, calories, protein_grams, points)
     VALUES ($1, $2, COALESCE($3,'Meal'), $4, $5, $6, COALESCE($7,10)) RETURNING *`,
    [req.userId, entry_date, meal_label, food, calories, protein_grams === '' ? null : protein_grams, points]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { food, meal_label, calories, protein_grams, eaten } = req.body;
  if (!validProtein(protein_grams)) {
    return res.status(400).json({ error: 'Protein must be between 0 and 1,000 grams.' });
  }
  const hasProtein = Object.prototype.hasOwnProperty.call(req.body, 'protein_grams');
  const result = await pool.query(
    `UPDATE diet_entries SET
       food = COALESCE($1, food),
       meal_label = COALESCE($2, meal_label),
       calories = COALESCE($3, calories),
       protein_grams = CASE WHEN $4 THEN $5::numeric ELSE protein_grams END,
       eaten = COALESCE($6, eaten)
     WHERE id = $7 AND user_id = $8 RETURNING *`,
    [food, meal_label, calories, hasProtein, protein_grams === '' ? null : protein_grams, eaten, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Diet entry not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM diet_entries WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
