process.env.SIGNUP_INVITE_CODE = ''; // open sign-up for tests, even if .env sets an invite code
const test = require('node:test');
const assert = require('node:assert/strict');

const { closeResources, createApp } = require('../server');
const { migrationVersions } = require('../db');

async function withServer(database, run) {
  const appDatabase = {
    async query(sql, params) {
      if (sql.includes('INSERT INTO api_rate_limits')) {
        return { rows: [{ hit_count: 1, window_started_at: new Date() }] };
      }
      if (typeof database.query === 'function') return database.query(sql, params);
      return { rows: [] };
    },
  };
  const server = createApp({ database: appDatabase }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test('health endpoints distinguish liveness from database readiness', async () => {
  assert.ok(migrationVersions().includes('004_weekly_rest_days'));
  assert.ok(migrationVersions().includes('005_body_tracking'));
  assert.ok(migrationVersions().includes('006_usernames'));
  assert.ok(migrationVersions().includes('007_workout_exercises'));
  assert.ok(migrationVersions().includes('008_monthly_cashflow'));
  assert.ok(migrationVersions().includes('009_bill_payments_recovery'));
  assert.ok(migrationVersions().includes('010_savings_and_cashflow_alerts'));
  await withServer({
    async query() { return { rows: migrationVersions().map((version) => ({ version })) }; },
  }, async (url) => {
    const live = await fetch(`${url}/api/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { ok: true });

    const ready = await fetch(`${url}/api/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true, database: 'ready' });
  });
});

test('CORS allowlist, preflight, request IDs, and proxy trust are configurable', async () => {
  const previousCors = process.env.CORS_ORIGIN;
  const previousProxy = process.env.TRUST_PROXY;
  process.env.CORS_ORIGIN = 'https://app.example.test, https://admin.example.test';
  process.env.TRUST_PROXY = '2';
  try {
    const app = createApp({ database: {} });
    assert.equal(app.get('trust proxy'), 2);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const allowed = await fetch(`${base}/api/health/live`, {
        headers: { Origin: 'https://app.example.test' },
      });
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example.test');
      assert.match(allowed.headers.get('x-request-id'), /^[0-9a-f-]{36}$/i);

      const denied = await fetch(`${base}/api/health/live`, {
        headers: { Origin: 'https://untrusted.example.test' },
      });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
      const preflight = await fetch(`${base}/api/auth/password/forgot`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.test',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example.test');
    } finally {
      await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  } finally {
    if (previousCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousCors;
    if (previousProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousProxy;
  }
});

test('shutdown stops the scheduler and closes the database after HTTP', async () => {
  const events = [];
  const server = createApp({ database: {} }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  await closeResources(server, async () => { events.push('scheduler'); }, {
    async end() { events.push('database'); },
  });
  assert.deepEqual(events, ['scheduler', 'database']);
});

test('app shell and chart library are served locally', async () => {
  await withServer({}, async (url) => {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /\/vendor\/chart\.umd\.js/);
    assert.doesNotMatch(html, /signup-invite-code|Invite code/i);
    assert.doesNotMatch(html, /https:\/\/(fonts\.googleapis\.com|cdn\.jsdelivr\.net)/);

    const chart = await fetch(`${url}/vendor/chart.umd.js`);
    assert.equal(chart.status, 200);
    assert.match(chart.headers.get('content-type'), /javascript/);

    const worker = await fetch(`${url}/sw.js`);
    assert.equal(worker.status, 200);
    const workerScript = await worker.text();
    assert.match(workerScript, /const CACHE = 'selfup-v\d+';/);
    const shellDeclaration = workerScript.match(/const SHELL = \[(.*?)\];/s);
    assert.ok(shellDeclaration, 'service worker should declare an app shell');
    const shellPaths = Array.from(shellDeclaration[1].matchAll(/'([^']+)'/g), (match) => match[1]);
    const shellResponses = await Promise.all(shellPaths.map((path) => fetch(new URL(path, url))));
    assert.ok(shellResponses.every((response) => response.ok), 'every pre-cached shell asset should be served');
  });
});

test('readiness returns 503 when a migration has not been applied', async () => {
  await withServer({
    async query() { return { rows: [] }; },
  }, async (url) => {
    const response = await fetch(`${url}/api/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'Database migrations are pending.' });
  });
});

test('readiness returns 503 when database or migration check fails', async () => {
  await withServer({
    async query() { throw new Error('database offline'); },
  }, async (url) => {
    const response = await fetch(`${url}/api/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Database is unavailable or migrations are pending.',
    });
  });
});

test('signup validates password length without requiring an invite code', async () => {
  await withServer({}, async (url) => {
    const response = await fetch(`${url}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Owner',
        email: 'owner@example.test',
        password: 'short',
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /12 characters/);
  });
});

test('password reset request response does not reveal whether the email exists', async () => {
  const smtpVariables = ['SMTP_HOST', 'SMTP_FROM', 'APP_URL'];
  const previous = Object.fromEntries(smtpVariables.map((key) => [key, process.env[key]]));
  for (const key of smtpVariables) delete process.env[key];
  try {
    await withServer({}, async (url) => {
      const responses = await Promise.all(['known@example.test', 'unknown@example.test'].map(async (email) => {
        const response = await fetch(`${url}/api/auth/password/forgot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        return { status: response.status, body: await response.json() };
      }));
      assert.deepEqual(responses[0], responses[1]);
      assert.equal(responses[0].status, 503);
      assert.match(responses[0].body.error, /not configured/);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
