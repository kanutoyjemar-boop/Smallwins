const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { idempotency } = require('./idempotency');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Session expired, please log in again.' });
  }

  try {
    const { rows } = await pool.query('SELECT token_version FROM users WHERE id = $1', [payload.userId]);
    if (!rows.length || rows[0].token_version !== (payload.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Session expired, please log in again.' });
    }
    req.userId = payload.userId;
    await idempotency(req, res, next);
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
