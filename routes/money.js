const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');
const { buildFinanceSummary, buildFinanceBreakdown } = require('../utils/finance');
const {
  isDateKey, monthStart, nextMonthStart, billDueDate, buildMonthlyOutlook,
} = require('../utils/monthly-cashflow');

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

async function ensureBillOccurrences(userId, date) {
  const month = monthStart(date);
  if (month < monthStart(todayKey())) return;
  const bills = await pool.query(
    `SELECT id, title, category, amount, due_day, start_month
       FROM recurring_bills
      WHERE user_id = $1 AND status = 'active' AND start_month <= $2`,
    [userId, month]
  );
  for (const bill of bills.rows) {
    const dueDate = billDueDate(month, bill.due_day);
    await pool.query(
      `INSERT INTO bill_occurrences
         (user_id, bill_id, bill_month, due_date, title, category, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, bill_id, bill_month) DO NOTHING`,
      [userId, bill.id, month, dueDate, bill.title, bill.category, bill.amount]
    );
  }
}

// GET /api/money?date=2026-09-15  -> expenses for that day + the day's budget
router.get('/', async (req, res) => {
  const date = req.query.date || todayKey();
  if (!isDateKey(date)) return res.status(400).json({ error: 'A valid date is required.' });
  const [expenses, budget] = await Promise.all([
    pool.query('SELECT * FROM expenses WHERE user_id = $1 AND expense_date = $2 ORDER BY id DESC', [req.userId, date]),
    pool.query('SELECT * FROM budgets WHERE user_id = $1 AND budget_date = $2', [req.userId, date]),
  ]);
  res.json({ expenses: expenses.rows, budget: budget.rows[0] || null });
});

router.get('/summary', async (req, res) => {
  const date = req.query.date || todayKey();
  if (!isDateKey(date)) return res.status(400).json({ error: 'A valid date is required.' });
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

router.get('/cashflow', async (req, res) => {
  const date = req.query.date || todayKey();
  if (!isDateKey(date)) return res.status(400).json({ error: 'A valid date is required.' });
  await ensureBillOccurrences(req.userId, date);
  const month = monthStart(date);
  const [allowance, bills, totals, occurrences, breakdown, savingsEntries] = await Promise.all([
    pool.query(
      `SELECT allowance_month, amount FROM monthly_allowances
        WHERE user_id = $1 AND allowance_month <= $2
        ORDER BY allowance_month DESC LIMIT 1`,
      [req.userId, month]
    ),
    pool.query(
      `SELECT id, title, category, amount, due_day, status,
              to_char(start_month, 'YYYY-MM-DD') AS start_month
         FROM recurring_bills WHERE user_id = $1
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END, due_day, id`,
      [req.userId]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE kind = 'income'), 0) AS income,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'expense'), 0) AS expenses,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'expense' AND recurring_bill_id IS NOT NULL), 0) AS paid_bills
       FROM expenses
       WHERE user_id = $1 AND expense_date >= $2 AND expense_date <= $3`,
      [req.userId, month, date]
    ),
    pool.query(
      `SELECT id, bill_id, to_char(bill_month, 'YYYY-MM-DD') AS bill_month,
              to_char(due_date, 'YYYY-MM-DD') AS due_date, title, category, amount,
              status, to_char(paid_at, 'YYYY-MM-DD') AS paid_at, expense_id
         FROM bill_occurrences WHERE user_id = $1 AND bill_month = $2
        ORDER BY due_date, id`,
      [req.userId, month]
    ),
    pool.query(
      `SELECT category, SUM(amount) AS total
         FROM expenses
        WHERE user_id = $1 AND kind = 'expense' AND expense_date >= $2 AND expense_date <= $3
        GROUP BY category ORDER BY SUM(amount) DESC`,
      [req.userId, month, date]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE kind = 'save'), 0) AS contributions,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'withdraw'), 0) AS withdrawals
       FROM savings_fund_entries
       WHERE user_id = $1 AND entry_date >= $2 AND entry_date <= $3`,
      [req.userId, month, date]
    ),
  ]);
  const unpaid = occurrences.rows.filter((occurrence) => occurrence.status === 'unpaid');
  const reserved = unpaid.reduce((sum, occurrence) => sum + Number(occurrence.amount), 0);
  const elapsedDays = Number(date.slice(8, 10));
  const monthDays = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  const actualExpenses = Number(totals.rows[0].expenses);
  const paidBills = Number(totals.rows[0].paid_bills);
  const outlook = buildMonthlyOutlook({
    allowance: allowance.rows[0] ? allowance.rows[0].amount : null,
    income: totals.rows[0].income,
    expenses: actualExpenses,
    paidBills,
    unpaidBills: reserved,
    savingsContributions: savingsEntries.rows[0].contributions,
    savingsWithdrawals: savingsEntries.rows[0].withdrawals,
    elapsedDays,
    daysInMonth: monthDays,
  });
  res.json({
    allowance: allowance.rows[0] || null,
    bills: bills.rows,
    occurrences: occurrences.rows,
    income: totals.rows[0].income,
    expenses: totals.rows[0].expenses,
    paidBills: totals.rows[0].paid_bills,
    ...outlook,
    breakdown: breakdown.rows,
    reserved,
    through: date,
  });
});

router.put('/allowance', async (req, res) => {
  const { allowance_month, amount } = req.body;
  if (!isDateKey(allowance_month) || monthStart(allowance_month) !== allowance_month) {
    return res.status(400).json({ error: 'Choose the first day of a valid month.' });
  }
  if (amount === null || amount === undefined || amount === '') {
    return res.status(400).json({ error: 'Enter a monthly allowance amount.' });
  }
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0 || value > 9999999999.99) {
    return res.status(400).json({ error: 'Monthly allowance must be a non-negative amount.' });
  }
  const result = await pool.query(
    `INSERT INTO monthly_allowances (user_id, allowance_month, amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, allowance_month) DO UPDATE SET amount = EXCLUDED.amount
     RETURNING allowance_month, amount`,
    [req.userId, allowance_month, value]
  );
  res.json(result.rows[0]);
});

router.post('/bills', async (req, res) => {
  const { title, category, amount, due_day, status } = req.body;
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const value = Number(amount);
  const day = Number(due_day);
  if (!cleanTitle || cleanTitle.length > 140 || !Number.isFinite(value) || value <= 0 ||
      value > 9999999999.99 || !Number.isInteger(day) || day < 1 || day > 31 ||
      (status !== undefined && !['active', 'inactive', 'finished'].includes(status))) {
    return res.status(400).json({ error: 'Enter a bill name, positive amount, and due day from 1 to 31.' });
  }
  const result = await pool.query(
    `INSERT INTO recurring_bills (user_id, start_month, title, category, amount, due_day, status)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'active'))
     RETURNING id, title, category, amount, due_day, status, to_char(start_month, 'YYYY-MM-DD') AS start_month`,
    [
      req.userId,
      day >= Number(todayKey().slice(8, 10)) ? monthStart(todayKey()) : nextMonthStart(todayKey()),
      cleanTitle,
      typeof category === 'string' && category.trim() ? category.trim().slice(0, 60) : 'Bills',
      value,
      day,
      status,
    ]
  );
  if (result.rows[0].status === 'active') await ensureBillOccurrences(req.userId, result.rows[0].start_month);
  res.status(201).json(result.rows[0]);
});

router.post('/bills/:id/pay', async (req, res) => {
  const billId = Number(req.params.id);
  const { bill_month } = req.body;
  if (!Number.isInteger(billId) || billId < 1 ||
      !isDateKey(bill_month) || monthStart(bill_month) !== bill_month) {
    return res.status(400).json({ error: 'Choose a valid bill and billing month.' });
  }
  await ensureBillOccurrences(req.userId, bill_month);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const occurrence = await client.query(
      `SELECT id, title, category, amount, status
         FROM bill_occurrences
        WHERE user_id = $1 AND bill_id = $2 AND bill_month = $3
        FOR UPDATE`,
      [req.userId, billId, bill_month]
    );
    if (!occurrence.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No bill occurrence was found for that month.' });
    }
    if (occurrence.rows[0].status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This bill is already marked paid.' });
    }
    const paidDate = todayKey();
    const expense = await client.query(
      `INSERT INTO expenses
         (user_id, expense_date, title, category, amount, kind, recurring_bill_id, bill_month)
       VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7)
       RETURNING id, expense_date, title, category, amount, kind`,
      [req.userId, paidDate, occurrence.rows[0].title, occurrence.rows[0].category,
        occurrence.rows[0].amount, billId, bill_month]
    );
    await client.query(
      `UPDATE bill_occurrences
          SET status = 'paid', paid_at = now(), expense_id = $1, updated_at = now()
        WHERE id = $2`,
      [expense.rows[0].id, occurrence.rows[0].id]
    );
    await client.query('COMMIT');
    res.status(201).json(expense.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/bills/:id/pay', async (req, res) => {
  const billId = Number(req.params.id);
  const billMonth = req.query.month;
  if (!Number.isInteger(billId) || billId < 1 ||
      !isDateKey(billMonth) || monthStart(billMonth) !== billMonth) {
    return res.status(400).json({ error: 'Choose a valid bill and billing month.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const occurrence = await client.query(
      `SELECT id, expense_id, status FROM bill_occurrences
        WHERE user_id = $1 AND bill_id = $2 AND bill_month = $3
        FOR UPDATE`,
      [req.userId, billId, billMonth]
    );
    if (!occurrence.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No bill occurrence was found for that month.' });
    }
    if (occurrence.rows[0].status !== 'paid' || !occurrence.rows[0].expense_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This bill is not marked paid.' });
    }
    await client.query(
      'DELETE FROM expenses WHERE id = $1 AND user_id = $2',
      [occurrence.rows[0].expense_id, req.userId]
    );
    await client.query(
      `UPDATE bill_occurrences
          SET status = 'unpaid', paid_at = NULL, expense_id = NULL, updated_at = now()
        WHERE id = $1`,
      [occurrence.rows[0].id]
    );
    await client.query('COMMIT');
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.patch('/bills/:id', async (req, res) => {
  const { title, category, amount, due_day, status } = req.body;
  const cleanTitle = title === undefined ? undefined : typeof title === 'string' ? title.trim() : '';
  const value = amount === undefined ? undefined : Number(amount);
  const day = due_day === undefined ? undefined : Number(due_day);
  if ((cleanTitle !== undefined && (!cleanTitle || cleanTitle.length > 140)) ||
      (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 9999999999.99)) ||
      (day !== undefined && (!Number.isInteger(day) || day < 1 || day > 31)) ||
      (status !== undefined && !['active', 'inactive', 'finished'].includes(status)) ||
      (category !== undefined && (typeof category !== 'string' || !category.trim() || category.length > 60))) {
    return res.status(400).json({ error: 'Check the bill name, amount, due day, category, and status.' });
  }
  const result = await pool.query(
    `UPDATE recurring_bills SET
       title = COALESCE($1, title),
       category = COALESCE($2, category),
       amount = COALESCE($3, amount),
       due_day = COALESCE($4, due_day),
       status = COALESCE($5, status),
       updated_at = now()
     WHERE id = $6 AND user_id = $7
     RETURNING id, title, category, amount, due_day, status,
               to_char(start_month, 'YYYY-MM-DD') AS start_month`,
    [cleanTitle, category && category.trim(), value, day, status, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Bill not found.' });
  if (status && status !== 'active') {
    await pool.query(
      `DELETE FROM bill_occurrences
        WHERE user_id = $1 AND bill_id = $2 AND status = 'unpaid' AND bill_month > $3`,
      [req.userId, req.params.id, monthStart(todayKey())]
    );
  } else if (status === 'active') {
    await ensureBillOccurrences(req.userId, todayKey());
  }
  const pendingOccurrences = await pool.query(
    `SELECT to_char(bill_month, 'YYYY-MM-DD') AS bill_month FROM bill_occurrences
      WHERE user_id = $1 AND bill_id = $2 AND status = 'unpaid' AND bill_month >= $3`,
    [req.userId, req.params.id, monthStart(todayKey())]
  );
  for (const occurrence of pendingOccurrences.rows) {
    const billMonth = String(occurrence.bill_month).slice(0, 7) + '-01';
    await pool.query(
      `UPDATE bill_occurrences
          SET title = $1, category = $2, amount = $3, due_date = $4, updated_at = now()
        WHERE user_id = $5 AND bill_id = $6 AND bill_month = $7 AND status = 'unpaid'`,
      [result.rows[0].title, result.rows[0].category, result.rows[0].amount,
        billDueDate(billMonth.slice(0, 7), result.rows[0].due_day),
        req.userId, req.params.id, occurrence.bill_month]
    );
  }
  res.json(result.rows[0]);
});

router.post('/', async (req, res) => {
  const { expense_date, title, category, amount, kind } = req.body;
  const value = Number(amount);
  if (!isDateKey(expense_date) || typeof title !== 'string' || !title.trim() || title.length > 140 ||
      !Number.isFinite(value) || value <= 0 || value > 9999999999.99 ||
      (kind !== undefined && !['expense', 'income'].includes(kind))) {
    return res.status(400).json({ error: 'Enter a valid date, description, positive amount, and transaction type.' });
  }
  const result = await pool.query(
    `INSERT INTO expenses (user_id, expense_date, title, category, amount, kind)
     VALUES ($1, $2, $3, COALESCE($4,'other'), $5, COALESCE($6,'expense')) RETURNING *`,
    [req.userId, expense_date, title.trim(), category, value, kind]
  );
  res.status(201).json(result.rows[0]);
});

router.patch('/:id', async (req, res) => {
  const { title, category, amount, kind } = req.body;
  const value = amount === undefined ? undefined : Number(amount);
  if ((title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 140)) ||
      (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 9999999999.99)) ||
      (kind !== undefined && !['expense', 'income'].includes(kind))) {
    return res.status(400).json({ error: 'Check the description, amount, and transaction type.' });
  }
  const existing = await pool.query(
    'SELECT recurring_bill_id FROM expenses WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (!existing.rows.length) return res.status(404).json({ error: 'Expense not found.' });
  if (existing.rows[0].recurring_bill_id !== null && kind === 'income') {
    return res.status(400).json({ error: 'A recurring bill payment must remain an expense.' });
  }
  const result = await pool.query(
    `UPDATE expenses SET
       title = COALESCE($1, title),
       category = COALESCE($2, category),
       amount = COALESCE($3, amount),
       kind = COALESCE($4, kind)
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [title && title.trim(), category, value, kind, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Expense not found.' });
  res.json(result.rows[0]);
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE bill_occurrences
          SET status = 'unpaid', paid_at = NULL, expense_id = NULL, updated_at = now()
        WHERE user_id = $1 AND expense_id = $2`,
      [req.userId, req.params.id]
    );
    await client.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
