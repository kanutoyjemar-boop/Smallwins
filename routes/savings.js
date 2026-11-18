const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { isDateKey } = require('../utils/monthly-cashflow');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

const MAX_AMOUNT = 9999999999.99;
const validFundId = (id) => /^\d+$/.test(id) && Number.isInteger(Number(id)) &&
  Number(id) > 0 && Number(id) <= 2147483647;

router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT f.id, f.export_key::text AS export_key, f.title, f.target_amount, f.status,
            to_char(f.created_at, 'YYYY-MM-DD') AS created_date,
            COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'save'), 0)
              - COALESCE(SUM(e.amount) FILTER (WHERE e.kind = 'withdraw'), 0) AS saved_amount
       FROM savings_funds f
       LEFT JOIN savings_fund_entries e ON e.fund_id = f.id AND e.user_id = f.user_id
      WHERE f.user_id = $1
      GROUP BY f.id
      ORDER BY CASE f.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, f.created_at DESC`,
    [req.userId]
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const target = Number(body.target_amount);
  if (!title || title.length > 140 || !Number.isFinite(target) || target <= 0 || target > MAX_AMOUNT) {
    return res.status(400).json({ error: 'Enter a fund name and a positive target amount.' });
  }
  const { rows } = await pool.query(
    `INSERT INTO savings_funds (user_id, title, target_amount)
     VALUES ($1, $2, $3)
     RETURNING id, export_key::text AS export_key, title, target_amount, status`,
    [req.userId, title, target]
  );
  res.status(201).json({ ...rows[0], saved_amount: 0 });
});

router.patch('/:id', async (req, res) => {
  if (!validFundId(req.params.id)) return res.status(400).json({ error: 'Choose a valid savings fund.' });
  const { title, target_amount, status } = req.body || {};
  const cleanTitle = title === undefined ? undefined : typeof title === 'string' ? title.trim() : '';
  const target = target_amount === undefined ? undefined : Number(target_amount);
  if ((cleanTitle !== undefined && (!cleanTitle || cleanTitle.length > 140)) ||
      (target !== undefined && (!Number.isFinite(target) || target <= 0 || target > MAX_AMOUNT)) ||
      (status !== undefined && !['active', 'paused', 'completed'].includes(status))) {
    return res.status(400).json({ error: 'Check the fund name, target amount, and status.' });
  }
  const { rows } = await pool.query(
    `UPDATE savings_funds SET
       title = COALESCE($1, title),
       target_amount = COALESCE($2, target_amount),
       status = COALESCE($3, status),
       updated_at = now()
     WHERE id = $4 AND user_id = $5
     RETURNING id, export_key::text AS export_key, title, target_amount, status`,
    [cleanTitle, target, status, req.params.id, req.userId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Savings fund not found.' });
  res.json(rows[0]);
});

router.post('/:id/entries', async (req, res) => {
  if (!validFundId(req.params.id)) return res.status(400).json({ error: 'Choose a valid savings fund.' });
  const body = req.body || {};
  const { kind } = body;
  const amount = Number(body.amount);
  const entryDate = body.entry_date === undefined ? todayKey() : body.entry_date;
  if (!['save', 'withdraw'].includes(kind) || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT ||
      !isDateKey(entryDate)) {
    return res.status(400).json({ error: 'Enter a valid fund action, date, and positive amount.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fund = await client.query(
      'SELECT id, status FROM savings_funds WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [req.params.id, req.userId]
    );
    if (!fund.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Savings fund not found.' });
    }
    if (kind === 'save' && fund.rows[0].status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Reopen this fund before adding savings.' });
    }
    const balance = await client.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'save'), 0)
                - COALESCE(SUM(amount) FILTER (WHERE kind = 'withdraw'), 0) AS balance
         FROM savings_fund_entries WHERE fund_id = $1 AND user_id = $2`,
      [req.params.id, req.userId]
    );
    if (kind === 'withdraw' && amount > Number(balance.rows[0].balance)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You cannot withdraw more than this fund currently holds.' });
    }
    const result = await client.query(
      `INSERT INTO savings_fund_entries (user_id, fund_id, entry_date, kind, amount)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, kind, amount`,
      [req.userId, req.params.id, entryDate, kind, amount]
    );
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

module.exports = router;
