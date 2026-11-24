const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');
const { buildFinanceSummary, buildFinanceBreakdown } = require('../utils/finance');

const router = express.Router();
router.use(requireAuth);

function addDays(dateStr, offset) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeBounds(dateStr, range) {
  const base = new Date(dateStr + 'T00:00:00');
  if (range === 'day') {
    return { start: dateStr, end: dateStr };
  }
  if (range === 'week') {
    const start = new Date(base);
    start.setDate(base.getDate() - 6);
    return {
      start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      end: dateStr,
    };
  }
  if (range === 'month') {
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return {
      start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
      end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
    };
  }
  if (range === 'year') {
    const start = new Date(base.getFullYear(), 0, 1);
    const end = new Date(base.getFullYear(), 11, 31);
    return {
      start: `${start.getFullYear()}-01-01`,
      end: `${end.getFullYear()}-12-31`,
    };
  }
  return { start: dateStr, end: dateStr };
}

function normalizeTrend(rows) {
  const map = {};
  for (const row of rows) {
    const key = row.expense_date;
    map[key] = (map[key] || { income: 0, expense: 0 });
    if (row.kind === 'income') map[key].income += Number(row.amount || 0);
    else map[key].expense += Number(row.amount || 0);
  }

  return Object.entries(map)
    .map(([date, values]) => ({
      date,
      income: values.income,
      expense: values.expense,
      net: values.income - values.expense,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// GET /api/money?date=2026-09-15  -> expenses for that day + the day's budget
router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  const [expenses, budget] = await Promise.all([
    pool.query('SELECT * FROM expenses WHERE user_id = $1 AND expense_date = $2 ORDER BY id DESC', [req.userId, date]),
    pool.query('SELECT * FROM budgets WHERE user_id = $1 AND budget_date = $2', [req.userId, date]),
  ]);
  res.json({ expenses: expenses.rows, budget: budget.rows[0] || null });
});

router.get('/summary', async (req, res) => {
  const date = req.query.date || todayKey();
  const range = req.query.range || 'month';
  const { start, end } = rangeBounds(date, range);

  const result = await pool.query(
    'SELECT * FROM expenses WHERE user_id = $1 AND expense_date BETWEEN $2 AND $3 ORDER BY expense_date DESC, id DESC',
    [req.userId, start, end]
  );

  const summary = buildFinanceSummary(result.rows);
  const categories = buildFinanceBreakdown(result.rows);
  const trend = normalizeTrend(result.rows);
  const totalDays = Math.max(1, trend.length || 1);
  const averageDailySpend = trend.length ? Math.round((summary.expenses / totalDays) * 100) / 100 : 0;
  const averageDailyIncome = trend.length ? Math.round((summary.income / totalDays) * 100) / 100 : 0;

  res.json({
    range,
    start,
    end,
    ...summary,
    averageDailySpend,
    averageDailyIncome,
    trend,
    categories,
    transactions: result.rows,
  });
});

router.post('/', async (req, res) => {
  const { expense_date, title, category, amount, kind } = req.body;
  if (!expense_date || !title || amount == null) {
    return res.status(400).json({ error: 'Date, title, and amount are required.' });
  }
  const result = await pool.query(
    `INSERT INTO expenses (user_id, expense_date, title, category, amount, kind)
     VALUES ($1, $2, $3, COALESCE($4,'other'), $5, COALESCE($6,'expense')) RETURNING *`,
    [req.userId, expense_date, title, category, amount, kind]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { title, category, amount, kind } = req.body;
  const result = await pool.query(
    `UPDATE expenses SET
       title = COALESCE($1, title),
       category = COALESCE($2, category),
       amount = COALESCE($3, amount),
       kind = COALESCE($4, kind)
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [title, category, amount, kind, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Expense not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

router.put('/budget', async (req, res) => {
  const { budget_date, daily_limit } = req.body;
  if (!budget_date || daily_limit == null) {
    return res.status(400).json({ error: 'Date and daily limit are required.' });
  }
  const result = await pool.query(
    `INSERT INTO budgets (user_id, budget_date, daily_limit) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, budget_date) DO UPDATE SET daily_limit = EXCLUDED.daily_limit
     RETURNING *`,
    [req.userId, budget_date, daily_limit]
  );
  res.json(result.rows[0]);
});

module.exports = router;
