process.env.SIGNUP_INVITE_CODE = ''; // open sign-up for tests, even if .env sets an invite code
// Exercises the browser-side offline queue (public/js/api.js) against the real API:
// queued creates/edits/deletes, temporary "pending" items, id remapping on sync,
// and skipping a rejected change without blocking the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('offline queue shows pending changes, remaps ids, and skips rejected changes', { skip: !databaseUrl }, async () => {
  require('fake-indexeddb/auto');
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.TRUST_PROXY = '1';
  const { pool, migrate } = require('../db');
  const { createApp } = require('../server');
  await migrate();

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const clientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  const email = `queue-${crypto.randomBytes(6).toString('hex')}@example.test`;

  // Minimal browser-like globals for api.js.
  const storage = new Map();
  const realFetch = fetch;
  let online = true;
  const saved = {};
  const setGlobal = (name, value) => { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); };
  setGlobal('window', globalThis);
  setGlobal('localStorage', {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  });
  const events = [];
  setGlobal('CustomEvent', class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } });
  setGlobal('dispatchEvent', (event) => { events.push(event); return true; });
  setGlobal('fetch', (url, options = {}) => (online
    ? realFetch(baseUrl + url, { ...options, headers: { ...(options.headers || {}), 'X-Forwarded-For': clientIp } })
    : Promise.reject(new TypeError('offline'))));

  try {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8')
      + '\nglobalThis.Api = Api; globalThis.DateUtil = DateUtil;';
    vm.runInThisContext(source);
    const { Api, DateUtil } = globalThis;

    const signup = await realFetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp },
      body: JSON.stringify({ name: 'Queue', email, password: 'queue-test-password-long' }),
    });
    const session = await signup.json();
    Api.setSession(session.token, session.user);

    const day = DateUtil.today();
    const existing = await Api.post('/tasks', { task_date: day, period: 'AM', title: 'Existing', points: 10 });
    await Api.get(`/tasks?date=${day}`); // saves an offline copy
    const accountCopy = await Api.get('/export');
    assert.ok(accountCopy.tasks.some((task) => task.title === 'Existing'));

    online = false;
    const offlineCopy = await Api.get('/export');
    assert.ok(offlineCopy.tasks.some((task) => task.title === 'Existing'), 'the full account copy is available offline');
    assert.ok((await Api.post('/tasks', { task_date: day, period: 'AM', title: 'Offline A', points: 10 })).queued);
    let list = await Api.get(`/tasks?date=${day}`);
    const cachedEvent = events.find((event) => event.type === 'selfup:cached-data');
    assert.ok(cachedEvent && Number.isFinite(cachedEvent.detail.savedAt), 'saved copies report when they were saved');
    assert.ok(Date.now() - cachedEvent.detail.savedAt < 60000);
    const pendingA = list.find((task) => task.title === 'Offline A');
    assert.ok(pendingA && String(pendingA.id).startsWith('pending-'), 'queued create shows immediately');

    await Api.patch(`/tasks/${pendingA.id}`, { done: true });
    list = await Api.get(`/tasks?date=${day}`);
    assert.equal(list.find((task) => task.title === 'Offline A').done, true);

    await Api.del(`/tasks/${existing.id}`);
    list = await Api.get(`/tasks?date=${day}`);
    assert.ok(!list.some((task) => task.title === 'Existing'), 'queued delete hides the item');

    await Api.post('/tasks', { task_date: day, period: 'PM', title: 'Offline B' });
    const pendingB = (await Api.get(`/tasks?date=${day}`)).find((task) => task.title === 'Offline B');
    await Api.del(`/tasks/${pendingB.id}`);
    assert.ok(!(await Api.get(`/tasks?date=${day}`)).some((task) => task.title === 'Offline B'));

    await Api.post('/tasks', { task_date: day, period: 'AM' }); // missing title: the server will refuse it
    await Api.post('/tasks', { task_date: day, period: 'PM', title: 'Offline C' });
    await assert.rejects(() => Api.del('/money/bills/1/pay?month=2026-11-01'), 'bill payments still need a connection');

    online = true;
    const result = await Api.flushQueue();
    assert.equal(result.synced, 6);
    assert.equal(result.skipped, 1);

    const remaining = await Api.queueEntries();
    assert.equal(remaining.length, 1, 'only the refused change stays for review');
    assert.equal(remaining[0].lastStatus, 400);
    assert.equal(await Api.queueBlocked(), true);

    const serverTasks = await (await realFetch(`${baseUrl}/api/tasks?date=${day}`, {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Forwarded-For': clientIp },
    })).json();
    assert.deepEqual(serverTasks.map((task) => `${task.title}:${task.done}`).sort(), ['Offline A:true', 'Offline C:false']);
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
