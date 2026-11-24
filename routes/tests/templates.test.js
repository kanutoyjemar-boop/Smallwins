const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const previousJwtSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'templates-test-secret';
require('../../utils/async-errors');
const { pool } = require('../../db');
const templates = require('../templates');

test('single-day routine application validates dates and skips existing and repeated items', async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const planned = new Set(['2026-11-24|AM|Plan the day']);
  const routine = {
    id: 'routine-1',
    kind: 'tasks',
    name: 'Morning plan',
    items: [
      { period: 'AM', title: 'Plan the day', points: 10 },
      { period: 'AM', title: 'Plan the day', points: 10 },
      { period: 'PM', title: 'Review the day', points: 10 },
    ],
  };
  const queryCalls = [];
  pool.query = async (sql) => {
    if (sql.includes('SELECT token_version FROM users')) return { rows: [{ token_version: 0 }] };
    if (sql.includes('FROM routine_templates WHERE id')) return { rows: [routine] };
    throw new Error(`Unexpected pool query: ${sql}`);
  };
  pool.connect = async () => ({
    async query(sql, values) {
      queryCalls.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0 };
      if (!sql.includes('WHERE NOT EXISTS')) return { rowCount: 1 };
      const key = `${values[1]}|${values[2]}|${values[3]}`;
      if (planned.has(key)) return { rowCount: 0 };
      planned.add(key);
      return { rowCount: 1 };
    },
    release() {},
  });

  const app = express();
  app.use(express.json());
  app.use('/api/templates', templates);
  app.use((error, req, res, next) => res.status(500).json({ error: error.message })); // eslint-disable-line no-unused-vars
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/templates/routine-1/apply`;
  const token = jwt.sign({ userId: 'user-1', tokenVersion: 0 }, process.env.JWT_SECRET);
  try {
    const invalid = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-02-30' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(queryCalls.length, 0);

    const first = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-24' }),
    });
    assert.equal(first.status, 201);
    assert.deepEqual(await first.json(), { ok: true, count: 1 });

    const repeated = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-24' }),
    });
    assert.equal(repeated.status, 201);
    assert.deepEqual(await repeated.json(), { ok: true, count: 0 });
    assert.equal(queryCalls.filter((sql) => sql.includes('INSERT INTO tasks')).length, 6);

    const invalidSelection = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-24', items: [] }),
    });
    assert.equal(invalidSelection.status, 400);

    const customized = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-24', items: [{ period: 'AM', title: 'Take a walk', points: 10 }] }),
    });
    assert.equal(customized.status, 201);
    assert.deepEqual(await customized.json(), { ok: true, count: 1 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  }
});
