const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../middleware/security');

function response() {
  return {
    headers: {},
    set(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; },
  };
}

test('database rateLimit blocks after max hits and sets Retry-After', async () => {
  let hits = 0;
  const limit = rateLimit({
    max: 2,
    windowMs: 1000,
    database: {
      async query() {
        hits += 1;
        return { rows: [{ hit_count: hits, window_started_at: new Date() }] };
      },
    },
  });
  let passed = 0;
  let blocked;
  for (let i = 0; i < 3; i++) {
    const res = response();
    await limit({ ip: '1.2.3.4', baseUrl: '/api/auth/login', path: '/' }, res, () => passed++);
    if (res.code === 429) blocked = res;
  }
  assert.equal(passed, 2);
  assert.equal(blocked.code, 429);
  assert.ok(blocked.headers['Retry-After']);
});

test('database rateLimit forwards storage failures instead of bypassing protection', async () => {
  const error = new Error('database unavailable');
  const limit = rateLimit({ database: { async query() { throw error; } } });
  let forwarded;
  await limit(
    { ip: '1.2.3.4', baseUrl: '/api/auth/login', path: '/' },
    response(),
    (err) => {
      if (!err) assert.fail('request must not pass when rate-limit storage fails');
      forwarded = err;
    }
  );
  assert.equal(forwarded, error);
});
