require('dotenv').config();
process.env.SIGNUP_INVITE_CODE = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('agenda reminder settings and schedule integrate with PostgreSQL', {
  skip: databaseUrl ? false : 'set TEST_DATABASE_URL to a disposable PostgreSQL database',
}, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.TRUST_PROXY = '0';

  const { pool, migrate } = require('../db');
  const { createApp } = require('../server');
  await migrate();

  const server = createApp().listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let token;
  const password = 'agenda-integration-test-password';
  const email = `agenda-${crypto.randomBytes(8).toString('hex')}@example.test`;
  const headers = () => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  try {
    const signup = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Agenda integration', email, password }),
    });
    assert.equal(signup.status, 200);
    token = (await signup.json()).token;
    assert.ok(token);

    const preferences = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        timezone: 'UTC',
        agenda_advance_enabled: true,
        agenda_advance_days_before: 3,
        agenda_advance_time: '18:30',
      }),
    });
    assert.equal(preferences.status, 200);
    const saved = (await preferences.json()).settings;
    assert.equal(saved.agenda_advance_enabled, true);
    assert.equal(saved.agenda_advance_days_before, 3);
    assert.equal(saved.agenda_advance_time, '18:30');

    const eventDate = '2099-12-30';
    const created = await fetch(`${baseUrl}/api/schedule`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        item_date: eventDate,
        title: 'Integration planning event',
        start_time: '10:00',
        planned_minutes: 45,
      }),
    });
    assert.equal(created.status, 201);

    const upcoming = await fetch(
      `${baseUrl}/api/schedule/upcoming?from=${eventDate}`,
      { headers: headers() }
    );
    assert.equal(upcoming.status, 200);
    const events = await upcoming.json();
    assert.ok(events.some((event) => (
      event.title === 'Integration planning event' && event.item_date === eventDate
    )));

    const invalidPreferences = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ agenda_advance_days_before: 8 }),
    });
    assert.equal(invalidPreferences.status, 400);
  } finally {
    if (token) {
      await fetch(`${baseUrl}/api/auth/me`, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ password }),
      });
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
