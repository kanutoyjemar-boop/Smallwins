process.env.SIGNUP_INVITE_CODE = '';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inviteCodeMatches, requiredInviteCode } = require('../utils/invite');
const { databaseSslConfig } = require('../utils/database-ssl');
const { createApp, resolveTrustProxy, resolveCorsOptions } = require('../server');

async function withServer(env, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const server = createApp({ database: { query: async () => ({ rows: [{ hit_count: 1, window_started_at: new Date() }] }) } }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const postJson = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---- invite code -------------------------------------------------------------

test('invite code is optional: with none configured any sign-up passes the gate', () => {
  assert.equal(requiredInviteCode({}), '');
  assert.equal(inviteCodeMatches(undefined, ''), true);
  assert.equal(inviteCodeMatches('anything', ''), true);
});

test('invite code must match exactly once configured', () => {
  assert.equal(inviteCodeMatches('s3cret-code', 's3cret-code'), true);
  assert.equal(inviteCodeMatches('  s3cret-code  ', 's3cret-code'), true);
  assert.equal(inviteCodeMatches('S3CRET-CODE', 's3cret-code'), false);
  assert.equal(inviteCodeMatches('', 's3cret-code'), false);
  assert.equal(inviteCodeMatches(undefined, 's3cret-code'), false);
  assert.equal(inviteCodeMatches(12345, '12345'), false);
});

test('sign-up is rejected without the right invite code and reports the requirement', async () => {
  await withServer({ SIGNUP_INVITE_CODE: 'let-me-in-42' }, async (url) => {
    const config = await (await fetch(`${url}/api/auth/signup-config`)).json();
    assert.deepEqual(config, { inviteRequired: true });

    const body = { name: 'Eve', email: 'eve@example.test', password: 'a-long-enough-password' };
    for (const inviteCode of [undefined, '', 'wrong']) {
      const res = await postJson(`${url}/api/auth/signup`, { ...body, inviteCode });
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /invite code/i);
    }
    // The right code gets past the gate (and then fails normal validation, never touching the DB).
    const ok = await postJson(`${url}/api/auth/signup`, { ...body, password: 'short', inviteCode: 'let-me-in-42' });
    assert.equal(ok.status, 400);
    assert.match((await ok.json()).error, /12 characters/);
  });
  await withServer({ SIGNUP_INVITE_CODE: '' }, async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/auth/signup-config`)).json(), { inviteRequired: false });
  });
});

// ---- headers -----------------------------------------------------------------

test('responses carry a strict CSP, no X-Powered-By, and HSTS only over HTTPS', async () => {
  await withServer({ TRUST_PROXY: '1' }, async (url) => {
    const plain = await fetch(`${url}/api/health/live`);
    const csp = plain.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.equal(plain.headers.get('x-powered-by'), null);
    assert.equal(plain.headers.get('strict-transport-security'), null);

    const proxied = await fetch(`${url}/api/health/live`, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(proxied.headers.get('strict-transport-security'), /max-age=\d+/);
  });
});

test('the web app has no inline scripts or inline event handlers (required by the CSP)', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js)$/.test(entry.name)) files.push(full);
    }
  })(publicDir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\son(click|change|input|submit|load|error|focus|blur)\s*=/i, `${file} has an inline handler`);
    assert.doesNotMatch(text, /javascript:/i, `${file} has a javascript: URL`);
    if (file.endsWith('.html')) {
      assert.deepEqual(text.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [], [], `${file} has an inline script`);
    }
  }
});

test('the service worker precaches every script the page loads', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) {
    assert.ok(sw.includes(`'${src}'`), `${src} is missing from the service worker shell`);
  }
});

// ---- deployment defaults -----------------------------------------------------

test('trust proxy: explicit value wins; Railway defaults to one hop; local defaults to none', () => {
  assert.equal(resolveTrustProxy({}), false);
  assert.equal(resolveTrustProxy({ RAILWAY_ENVIRONMENT: 'production' }), 1);
  assert.equal(resolveTrustProxy({ RAILWAY_PROJECT_ID: 'abc' }), 1);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: '0', RAILWAY_ENVIRONMENT: 'production' }), 0);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: '2' }), 2);
  assert.equal(resolveTrustProxy({ TRUST_PROXY: 'false', RAILWAY_ENVIRONMENT: 'production' }), false);
});

test('CORS: closed in production unless CORS_ORIGIN is set; unchanged in development', () => {
  assert.deepEqual(resolveCorsOptions({ NODE_ENV: 'production' }), { origin: false });
  assert.deepEqual(
    resolveCorsOptions({ NODE_ENV: 'production', CORS_ORIGIN: 'https://a.example, https://b.example' }),
    { origin: ['https://a.example', 'https://b.example'] }
  );
  assert.equal(resolveCorsOptions({ NODE_ENV: 'development' }), undefined);
});

test('database TLS: private hosts skip verification, public hosts stay verified in production', () => {
  const production = { nodeEnv: 'production' };
  assert.equal(databaseSslConfig({ ...production, connectionString: 'postgresql://u:p@postgres.railway.internal:5432/db' }), false);
  assert.equal(databaseSslConfig({ ...production, connectionString: 'postgresql://u:p@localhost:5432/db' }), false);
  assert.equal(databaseSslConfig({ ...production, connectionString: 'postgresql://u:p@127.0.0.1:5432/db' }), false);
  assert.deepEqual(
    databaseSslConfig({ ...production, connectionString: 'postgresql://u:p@db.example.com:5432/db' }),
    { rejectUnauthorized: true }
  );
  assert.deepEqual(databaseSslConfig({ ...production, connectionString: 'not a url' }), { rejectUnauthorized: true });
  // An explicit setting always wins over host detection.
  assert.equal(databaseSslConfig({ ...production, mode: 'disable', connectionString: 'postgresql://u:p@db.example.com/db' }), false);
  assert.deepEqual(
    databaseSslConfig({ ...production, mode: 'verify-full', connectionString: 'postgresql://u:p@postgres.railway.internal/db' }),
    { rejectUnauthorized: true }
  );
});
