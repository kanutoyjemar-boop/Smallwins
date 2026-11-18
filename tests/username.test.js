const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/selfup_test';
process.env.JWT_SECRET ||= 'username-test-secret';

const { pool } = require('../db');
const authRouter = require('../routes/auth');

test('account usernames are readable, editable, normalized, and unique', async () => {
  const originalQuery = pool.query;
  let usernameTaken = false;
  pool.query = async (sql, params) => {
    if (sql.includes('SELECT token_version')) return { rows: [{ token_version: 0 }] };
    if (sql.startsWith('SELECT id, name, username, email FROM users')) {
      return { rows: [{ id: 7, name: 'Alex Rivera', username: 'alex_rivera', email: 'alex@example.test' }] };
    }
    if (sql.startsWith('SELECT id FROM users WHERE username')) {
      return { rows: usernameTaken ? [{ id: 8 }] : [] };
    }
    if (sql.startsWith('UPDATE users SET')) {
      return { rows: [{ id: params[3], name: params[0] || 'Alex Rivera', username: params[1] || 'alex_rivera', email: params[2] || 'alex@example.test' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const token = jwt.sign({ userId: 7, tokenVersion: 0 }, process.env.JWT_SECRET);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = `http://127.0.0.1:${server.address().port}/api/auth/me`;
  try {
    const profile = await fetch(url, { headers });
    assert.equal(profile.status, 200);
    assert.equal((await profile.json()).username, 'alex_rivera');

    const updated = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ username: 'New_Handle' }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).username, 'new_handle');

    const invalid = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ username: 'not valid!' }),
    });
    assert.equal(invalid.status, 400);

    usernameTaken = true;
    const duplicate = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ username: 'someone_else' }),
    });
    assert.equal(duplicate.status, 409);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    pool.query = originalQuery;
  }
});
