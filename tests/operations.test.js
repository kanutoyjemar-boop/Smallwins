const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createScheduler, dueWithinRecoveryWindow, getAgendaForUser, getBillsDue,
  getCashflowBalance, localDateTime,
} = require('../utils/scheduler');
const { buildCalendar } = require('../utils/ical');
const mailer = require('../utils/mailer');
const { databaseIdentity } = require('../scripts/verify-restore');

test('reminder recovery window is bounded and does not roll across midnight', () => {
  assert.equal(dueWithinRecoveryWindow('07:35', '07:30'), true);
  assert.equal(dueWithinRecoveryWindow('07:41', '07:30'), false);
  assert.equal(dueWithinRecoveryWindow('00:02', '23:59'), false);
});

test('local reminder dates and times use the configured timezone', () => {
  const local = localDateTime('Asia/Manila', new Date('2026-01-01T16:30:00Z'));
  assert.deepEqual(local, { date: '2026-01-02', time: '00:30' });
});

test('low-balance calculations include unpaid bills and net savings allocations', async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /savings_fund_entries/);
      assert.deepEqual(params, [41, '2026-11-11']);
      return {
        rows: [{
          allowance: '1000',
          income: '250',
          expenses: '300',
          reserved: '200',
          saved: '100',
          withdrawn: '50',
        }],
      };
    },
  };
  assert.equal(await getCashflowBalance(database, 41, '2026-11-11'), 700);
  assert.equal(await getCashflowBalance({ query: async () => ({ rows: [{ allowance: null }] }) }, 41, '2026-11-11'), null);
});

test('bill due lookup considers an unpaid current occurrence even after a bill is paused', async () => {
  let queryText = '';
  const database = {
    async query(sql, params) {
      queryText = sql;
      assert.deepEqual(params, [41, '2026-11-13']);
      return { rows: [{ id: 8, title: 'Water', amount: '40.00' }] };
    },
  };
  const bills = await getBillsDue(database, 41, '2026-11-13');
  assert.equal(bills[0].title, 'Water');
  assert.match(queryText, /o\.status = 'unpaid'/);
});

test('calendar export escapes text, emits timed and all-day events, and folds UTF-8 lines', () => {
  const calendar = buildCalendar([
    {
      id: 1,
      item_date: '2026-04-02',
      title: 'Plan, with; details\\ and a deliberately long title ' + 'é'.repeat(60),
      location: 'Studio, north',
      start_time: '23:45:00',
      planned_minutes: 30,
      status: 'pending',
    },
    { id: 2, item_date: '2026-04-03', title: 'Rest day', start_time: null },
  ], 7, new Date('2026-04-01T12:00:00Z'));
  const lines = calendar.split('\r\n').filter(Boolean);

  assert.ok(calendar.includes('SUMMARY:Plan\\, with\\; details\\\\ and a deliberately long title'));
  assert.match(calendar, /DTSTART:20260402T234500\r\nDTEND:20260403T001500/);
  assert.match(calendar, /DTSTART;VALUE=DATE:20260403\r\nDTEND;VALUE=DATE:20260404/);
  assert.ok(lines.every((line) => Buffer.byteLength(line, 'utf8') <= 73));
});

test('scheduler uses a cross-instance lock and persists one delivery per day', async () => {
  const now = localDateTime('UTC');
  const settings = [{
    user_id: 17,
    timezone: 'UTC',
    smart_enabled: false,
    morning_enabled: true,
    morning_time: now.time,
    evening_enabled: false,
    evening_time: '18:30',
    streak_enabled: false,
    streak_time: '21:00',
  }];
  let deliveryStatus = null;
  let sends = 0;
  let released = 0;
  const database = {
    async connect() {
      return {
        async query() { return { rows: [{ locked: true }] }; },
        release() { released += 1; },
      };
    },
    async query(sql) {
      if (sql.includes('SELECT * FROM notification_settings')) return { rows: settings };
      if (sql.includes('SELECT status, updated_at FROM notification_deliveries')) {
        return { rows: deliveryStatus ? [{ status: deliveryStatus, updated_at: new Date() }] : [] };
      }
      if (sql.includes('INSERT INTO notification_deliveries')) {
        if (deliveryStatus) return { rows: [] };
        deliveryStatus = 'sending';
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes('UPDATE notification_deliveries')) {
        deliveryStatus = sql.includes("status = 'sent'") ? 'sent' : 'sent';
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const scheduler = createScheduler({
    database,
    pushClient: {
      isConfigured: () => true,
      async sendToUser() { sends += 1; return { sent: 1 }; },
    },
    getDayForUser: async () => ({
      tasks: [{ period: 'AM', done: false }],
      summary: { percentage: 50 },
    }),
    getStreak: async () => ({}),
    makePushMessage: () => ({ title: 'Reminder', body: 'Test' }),
  });

  await scheduler.tick();
  await scheduler.tick();
  assert.equal(sends, 1);
  assert.equal(deliveryStatus, 'sent');
  assert.equal(released, 2);
});

test('scheduler sends one local-time agenda reminder with pending events', async () => {
  const now = localDateTime('UTC');
  const settings = [{
    user_id: 29,
    timezone: 'UTC',
    smart_enabled: false,
    morning_enabled: false,
    evening_enabled: false,
    streak_enabled: false,
    agenda_enabled: true,
    agenda_time: now.time,
  }];
  const deliveries = new Map();
  const sent = [];
  const database = {
    async connect() {
      return {
        async query() { return { rows: [{ locked: true }] }; },
        release() {},
      };
    },
    async query(sql, params = []) {
      if (sql.includes('SELECT * FROM notification_settings')) return { rows: settings };
      if (sql.includes('SELECT status, updated_at FROM notification_deliveries')) {
        const status = deliveries.get(`${params[0]}:${params[1]}:${params[2]}`);
        return { rows: status ? [{ status, updated_at: new Date() }] : [] };
      }
      if (sql.includes('INSERT INTO notification_deliveries')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        if (deliveries.has(key)) return { rows: [] };
        deliveries.set(key, 'sending');
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes('UPDATE notification_deliveries')) {
        deliveries.set('29:agenda:' + now.date, params[1]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const scheduler = createScheduler({
    database,
    pushClient: {
      isConfigured: () => true,
      async sendToUser(userId, payload) {
        sent.push({ userId, payload });
        return { sent: 1 };
      },
    },
    getAgendaForUser: async (_database, userId, date, time) => {
      assert.equal(userId, 29);
      assert.equal(date, now.date);
      assert.equal(time, now.time);
      return [
        { title: 'Planning', start_time: '09:30:00' },
        { title: 'Walk', start_time: null },
      ];
    },
  });

  await scheduler.tick();
  await scheduler.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.title, "2 events on today's agenda");
  assert.equal(sent[0].payload.body, '09:30 Planning · Walk');
  assert.equal(sent[0].payload.url, '/#/schedule');
  assert.equal(deliveries.get(`29:agenda:${now.date}`), 'sent');
});

test('scheduler sends the configured advance agenda reminder once with the target date', async () => {
  const now = localDateTime('UTC');
  const settings = [{
    user_id: 31,
    timezone: 'UTC',
    smart_enabled: false,
    morning_enabled: false,
    evening_enabled: false,
    streak_enabled: false,
    agenda_advance_enabled: true,
    agenda_advance_days_before: 2,
    agenda_advance_time: now.time,
  }];
  const deliveries = new Map();
  const sent = [];
  const database = {
    async connect() {
      return {
        async query() { return { rows: [{ locked: true }] }; },
        release() {},
      };
    },
    async query(sql, params = []) {
      if (sql.includes('SELECT * FROM notification_settings')) return { rows: settings };
      if (sql.includes('SELECT status, updated_at FROM notification_deliveries')) {
        const status = deliveries.get(`${params[0]}:${params[1]}:${params[2]}`);
        return { rows: status ? [{ status, updated_at: new Date() }] : [] };
      }
      if (sql.includes('INSERT INTO notification_deliveries')) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        if (deliveries.has(key)) return { rows: [] };
        deliveries.set(key, 'sending');
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes('UPDATE notification_deliveries')) {
        deliveries.set(`31:agenda_advance:${now.date}`, params[1]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const scheduler = createScheduler({
    database,
    pushClient: {
      isConfigured: () => true,
      async sendToUser(userId, payload) {
        sent.push({ userId, payload });
        return { sent: 1 };
      },
    },
    getAgendaForUser: async (_database, userId, date, time) => {
      assert.equal(userId, 31);
      assert.equal(date, require('../utils/date').addDays(now.date, 2));
      assert.equal(time, null);
      return [{ title: 'Project review', start_time: '10:00:00' }];
    },
  });

  await scheduler.tick();
  await scheduler.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.title, 'Agenda in 2 days');
  assert.equal(sent[0].payload.body, '10:00 Project review');
  assert.equal(sent[0].payload.url, '/#/schedule');
  assert.equal(deliveries.get(`31:agenda_advance:${now.date}`), 'sent');
});

test('agenda reminder lookup only returns pending events for the requested day', async () => {
  const database = {
    async query(sql, params) {
      assert.match(sql, /status = 'pending'/);
      assert.match(sql, /\$3::time IS NULL OR start_time IS NULL OR start_time >= \$3::time/);
      assert.match(sql, /ORDER BY start_time NULLS LAST/);
      assert.deepEqual(params, [29, '2026-04-02', '08:00']);
      return { rows: [{ title: 'Planning', start_time: '09:30:00' }] };
    },
  };
  assert.deepEqual(await getAgendaForUser(database, 29, '2026-04-02', '08:00'), [
    { title: 'Planning', start_time: '09:30:00' },
  ]);
});

test('scheduler exits without querying reminders when another instance holds the lock', async () => {
  let reminderQueries = 0;
  const database = {
    async connect() {
      return {
        async query() { return { rows: [{ locked: false }] }; },
        release() {},
      };
    },
    async query() { reminderQueries += 1; return { rows: [] }; },
  };
  await createScheduler({
    database,
    pushClient: { isConfigured: () => true },
  }).tick();
  assert.equal(reminderQueries, 0);
});

test('scheduler sends grouped bill and low-balance alerts once per scheduled day', async () => {
  const now = localDateTime('UTC');
  const settings = [{
    user_id: 23,
    timezone: 'UTC',
    smart_enabled: false,
    morning_enabled: false,
    evening_enabled: false,
    streak_enabled: false,
    bill_due_enabled: true,
    bill_due_days_before: 2,
    bill_due_time: now.time,
    low_balance_enabled: true,
    low_balance_threshold: 100,
    low_balance_time: now.time,
  }];
  const deliveries = new Map();
  const ids = new Map();
  let nextId = 1;
  const sent = [];
  const database = {
    async connect() {
      return {
        async query() { return { rows: [{ locked: true }] }; },
        release() {},
      };
    },
    async query(sql, params = []) {
      if (sql.includes('SELECT * FROM notification_settings')) return { rows: settings };
      if (sql.includes('SELECT status, updated_at FROM notification_deliveries')) {
        const key = `${params[1]}:${params[0]}:${params[2]}`;
        const delivery = deliveries.get(key);
        return { rows: delivery ? [{ status: delivery.status, updated_at: new Date() }] : [] };
      }
      if (sql.includes("status = 'sent'")) {
        const month = params[1].slice(0, 7);
        const found = [...deliveries.entries()].some(([key, delivery]) => {
          const [type, userId, date] = key.split(':');
          return type === 'low_balance' && Number(userId) === Number(params[0]) &&
            date >= month && delivery.status === 'sent';
        });
        return { rows: found ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('INSERT INTO notification_deliveries')) {
        const key = `${params[1]}:${params[0]}:${params[2]}`;
        if (deliveries.has(key)) return { rows: [] };
        const id = nextId++;
        const delivery = { id, status: 'sending' };
        deliveries.set(key, delivery);
        ids.set(id, delivery);
        return { rows: [{ id }] };
      }
      if (sql.includes('UPDATE notification_deliveries')) {
        const delivery = ids.get(params[0]);
        if (delivery) delivery.status = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const scheduler = createScheduler({
    database,
    pushClient: {
      isConfigured: () => true,
      async sendToUser(userId, payload) { sent.push({ userId, payload }); return { sent: 1 }; },
    },
    getBillsDueForUser: async (_database, userId, dueDate) => {
      assert.equal(userId, 23);
      assert.equal(dueDate, require('../utils/date').addDays(now.date, 2));
      return [{ title: 'Internet', amount: 50 }, { title: 'Water', amount: 25 }];
    },
    getBalanceForUser: async () => 40,
  });

  await scheduler.tick();
  await scheduler.tick();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.title, '2 bills due soon');
  assert.match(sent[0].payload.body, /Internet, Water · ₱75\.00/);
  assert.equal(sent[1].payload.title, 'Cash-flow check-in');
  assert.equal([...deliveries.values()].filter((delivery) => delivery.status === 'sent').length, 2);
});

test('restore verifier distinguishes different databases and rejects the same target', () => {
  assert.notEqual(
    databaseIdentity('postgres://user:pass@db.example.test:5432/live'),
    databaseIdentity('postgres://user:pass@db.example.test:5432/restore')
  );
  assert.equal(
    databaseIdentity('postgres://user:pass@db.example.test:5432/live'),
    databaseIdentity('postgres://other:secret@db.example.test:5432/live')
  );
});

test('SMTP remains optional but partial email configuration fails clearly', () => {
  const keys = ['SMTP_HOST', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS', 'APP_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.doesNotThrow(() => mailer.validateConfig());
    process.env.SMTP_HOST = 'smtp.example.test';
    assert.throws(() => mailer.validateConfig(), /SMTP_HOST, SMTP_FROM, and APP_URL/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
