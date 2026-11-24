const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../utils/rate-limit');

test('rateLimit allows max requests per window then answers 429 with Retry-After', () => {
  const limiter = rateLimit({ windowMs: 60000, max: 2 });
  const run = (ip) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    let passed = false;
    limiter({ ip, socket: {} }, res, () => { passed = true; });
    return { passed, res };
  };
  assert.equal(run('1.1.1.1').passed, true);
  assert.equal(run('1.1.1.1').passed, true);
  const blocked = run('1.1.1.1');
  assert.equal(blocked.passed, false);
  assert.equal(blocked.res.code, 429);
  assert.ok(Number(blocked.res.headers['Retry-After']) > 0);
  assert.equal(run('2.2.2.2').passed, true, 'other clients are unaffected');
});
