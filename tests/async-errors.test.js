const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
require('../utils/async-errors');

test('rejected async route handlers reach the error middleware', async () => {
  const app = express();
  const router = express.Router();
  router.get('/boom', async () => { throw new Error('kaboom'); });
  router.get('/ok', async (req, res) => res.json({ ok: true }));
  app.use(router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message })); // eslint-disable-line no-unused-vars

  const server = app.listen(0);
  const get = (path) => new Promise((resolve) => {
    http.get({ port: server.address().port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve([res.statusCode, JSON.parse(body)]));
    });
  });
  try {
    assert.deepEqual(await get('/boom'), [500, { error: 'kaboom' }]);
    assert.deepEqual(await get('/ok'), [200, { ok: true }]);
  } finally {
    server.close();
  }
});
