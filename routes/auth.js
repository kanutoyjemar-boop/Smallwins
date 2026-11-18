const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const mailer = require('../utils/mailer');
const logger = require('../utils/logger');
const { requiredInviteCode, inviteCodeMatches } = require('../utils/invite');

const router = express.Router();
const RESET_RESPONSE = {
  ok: true,
  message: 'If an account exists for that email, password reset instructions will be sent.',
};

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, tokenVersion: user.token_version || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '90d' }
  );
}

function makeUsername(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 18) || 'member';
  return `${base}_${crypto.randomBytes(2).toString('hex')}`;
}

function validUsername(username) {
  return typeof username === 'string' && /^[a-z0-9_]{3,24}$/.test(username);
}

// GET /api/auth/signup-config -> lets the sign-up form know whether an invite code is needed.
router.get('/signup-config', (req, res) => {
  res.json({ inviteRequired: Boolean(requiredInviteCode()) });
});

router.post('/signup', async (req, res) => {
  const { name, email, password, inviteCode } = req.body || {};
  if (!inviteCodeMatches(inviteCode)) {
    return res.status(403).json({ error: 'A valid invite code is required to create an account.' });
  }
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
    || !name.trim() || !email.trim() || !password) {
    return res.status(400).json({ error: 'Name, email, and password are all required.' });
  }
  if (name.trim().length > 80 || email.trim().length > 254) {
    return res.status(400).json({ error: 'Name or email is too long.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters.' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const username = makeUsername(name.trim());
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, username, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, name, username, email, token_version`,
      [name.trim(), username, normalizedEmail, hash]
    );
    if (!result.rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const user = result.rows[0];
    res.json({
      token: makeToken(user),
      user: { id: user.id, name: user.name, username: user.username, email: user.email },
    });
  } catch (err) {
    logger.error('account_signup_failed', { requestId: req.requestId, errorName: err.name, errorCode: err.code });
    res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, username, email, password_hash, token_version FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    res.json({ token: makeToken(user), user: { id: user.id, name: user.name, username: user.username, email: user.email } });
  } catch (err) {
    logger.error('account_login_failed', { requestId: req.requestId, errorName: err.name, errorCode: err.code });
    res.status(500).json({ error: 'Could not log in.' });
  }
});

router.post('/password/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!mailer.isConfigured()) {
    return res.status(503).json({ error: 'Password reset email is not configured on this server.' });
  }

  const result = await pool.query(
    'SELECT id, email FROM users WHERE email = $1',
    [email.trim().toLowerCase()]
  );
  const user = result.rows[0];
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await pool.query(
      `UPDATE users SET password_reset_token_hash = $1,
         password_reset_expires_at = now() + interval '1 hour'
       WHERE id = $2`,
      [tokenHash, user.id]
    );
    try {
      const resetUrl = new URL(process.env.APP_URL);
      resetUrl.hash = new URLSearchParams({ reset_token: token }).toString();
      await mailer.sendPasswordReset(user.email, resetUrl.toString());
    } catch (err) {
      logger.error('password_reset_email_failed', {
        requestId: req.requestId,
        errorName: err.name,
        errorCode: err.code,
      });
    }
  }
  res.status(202).json(RESET_RESPONSE);
});

router.post('/password/reset', async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
    || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'Provide a valid reset link and a password of at least 12 characters.' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const valid = await pool.query(
    `SELECT id FROM users
     WHERE password_reset_token_hash = $1 AND password_reset_expires_at > now()`,
    [tokenHash]
  );
  if (!valid.rows.length) {
    return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await pool.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1,
       password_reset_token_hash = NULL, password_reset_expires_at = NULL
     WHERE id = $2 AND password_reset_token_hash = $3
       AND password_reset_expires_at > now()
     RETURNING id`,
    [passwordHash, valid.rows[0].id, tokenHash]
  );
  if (!updated.rowCount) {
    return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
  }
  res.json({ ok: true });
});

// GET /api/auth/me -> the logged-in user's own profile.
router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT id, name, username, email FROM users WHERE id = $1', [req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'Account not found.' });
  res.json(result.rows[0]);
});

// PATCH /api/auth/me -> update name, username, and/or email.
router.patch('/me', requireAuth, async (req, res) => {
  const { name, username, email } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 120)) {
    return res.status(400).json({ error: 'Name must contain 1–120 characters.' });
  }
  if (username !== undefined) {
    if (typeof username !== 'string' || !validUsername(username.toLowerCase())) {
      return res.status(400).json({ error: 'Username must be 3–24 characters using lowercase letters, numbers, or underscores.' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username.toLowerCase(), req.userId]);
    if (existing.rows.length) return res.status(409).json({ error: 'That username is already taken.' });
  }
  if (email !== undefined) {
    if (typeof email !== 'string' || !email.trim() || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.trim().toLowerCase(), req.userId]);
    if (existing.rows.length) return res.status(409).json({ error: 'Another account already uses that email.' });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         username = COALESCE($2, username),
         email = COALESCE($3, email)
       WHERE id = $4 RETURNING id, name, username, email`,
      [name ? name.trim() : null, username ? username.toLowerCase() : null, email ? email.toLowerCase().trim() : null, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505' && ['users_username_key', 'idx_users_username'].includes(err.constraint)) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    logger.error('account_profile_update_failed', {
      requestId: req.requestId,
      errorName: err.name,
      errorCode: err.code,
    });
    res.status(500).json({ error: 'Could not update account.' });
  }
});

// POST /api/auth/change-password -> requires the current password, no email flow needed.
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are both required.' });
  }
  if (newPassword.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters.' });
  }

  const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const hash = await bcrypt.hash(newPassword, 10);
  const updated = await pool.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1
     WHERE id = $2 RETURNING id, name, username, email, token_version`,
    [hash, req.userId]
  );
  res.json({ ok: true, token: makeToken(updated.rows[0]), user: {
    id: updated.rows[0].id,
    name: updated.rows[0].name,
    username: updated.rows[0].username,
    email: updated.rows[0].email,
  } });
});

router.post('/delete-account', requireAuth, async (req, res) => {
  const { password, confirmation } = req.body || {};
  if (typeof password !== 'string' || confirmation !== 'DELETE') {
    return res.status(400).json({ error: 'Enter your password and type DELETE to confirm account removal.' });
  }
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!await bcrypt.compare(password, user.password_hash)) {
    return res.status(403).json({ error: 'Password is incorrect.' });
  }

  const deleted = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.userId]);
  if (!deleted.rowCount) return res.status(404).json({ error: 'Account not found.' });
  res.status(204).end();
});

module.exports = router;
