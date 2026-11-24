const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function makeToken(user) {
  return jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '90d' });
}

router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are all required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email.toLowerCase(), hash]
    );
    const user = result.rows[0];
    res.json({ token: makeToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    res.json({ token: makeToken(user), user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

// GET /api/auth/me -> the logged-in user's own profile.
router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'Account not found.' });
  res.json(result.rows[0]);
});

// PATCH /api/auth/me -> update name and/or email.
router.patch('/me', requireAuth, async (req, res) => {
  const { name, email } = req.body;
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'Name cannot be empty.' });
  }
  if (email !== undefined) {
    if (!email.trim()) return res.status(400).json({ error: 'Email cannot be empty.' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase(), req.userId]);
    if (existing.rows.length) return res.status(409).json({ error: 'Another account already uses that email.' });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         email = COALESCE($2, email)
       WHERE id = $3 RETURNING id, name, email`,
      [name ? name.trim() : null, email ? email.toLowerCase().trim() : null, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update account.' });
  }
});

// POST /api/auth/change-password -> requires the current password, no email flow needed.
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are both required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);
  res.json({ ok: true });
});

module.exports = router;
