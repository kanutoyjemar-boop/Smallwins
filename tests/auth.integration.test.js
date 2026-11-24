process.env.SIGNUP_INVITE_CODE = ''; // open sign-up for tests, even if .env sets an invite code
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('signup, login, and task access are isolated per account', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  const previousTrustProxy = process.env.TRUST_PROXY;
  const testClientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  process.env.TRUST_PROXY = '1';
  const { pool, migrate } = require('../db');
  const { createApp } = require('../server');
  await migrate();

  const suffix = crypto.randomBytes(6).toString('hex');
  const ownerEmail = `owner-${suffix}@example.test`;
  const otherEmail = `other-${suffix}@example.test`;
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function post(path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testClientIp,
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  }

  try {
    const owner = await post('/api/auth/signup', {
      name: 'Owner',
      email: ownerEmail,
      password: 'a-strong-test-password',
    });
    assert.equal(owner.response.status, 200);

    const duplicate = await post('/api/auth/signup', {
      name: 'Owner again',
      email: ownerEmail,
      password: 'a-different-strong-password',
    });
    assert.equal(duplicate.response.status, 409);

    const other = await post('/api/auth/signup', {
      name: 'Other',
      email: otherEmail,
      password: 'another-strong-test-password',
    });
    assert.equal(other.response.status, 200);

    const login = await post('/api/auth/login', {
      email: ownerEmail,
      password: 'a-strong-test-password',
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body.token);
    const headers = (token) => ({ Authorization: `Bearer ${token}` });
    const now = new Date();
    const allowanceMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const allowanceResponse = await fetch(`${baseUrl}/api/money/allowance`, {
      method: 'PUT',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowance_month: allowanceMonth, amount: 1000 }),
    });
    assert.equal(allowanceResponse.status, 200);
    const billResponse = await fetch(`${baseUrl}/api/money/bills`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Integration test bill', amount: 25, due_day: 1 }),
    });
    assert.equal(billResponse.status, 201);
    const bill = await billResponse.json();
    const billPayment = await fetch(`${baseUrl}/api/money/bills/${bill.id}/pay`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ bill_month: bill.start_month }),
    });
    assert.equal(billPayment.status, 201);
    const payment = await billPayment.json();
    const convertBillPaymentToIncome = await fetch(`${baseUrl}/api/money/${payment.id}`, {
      method: 'PATCH',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'income' }),
    });
    assert.equal(convertBillPaymentToIncome.status, 400);
    const unchangedPayment = await pool.query(
      'SELECT kind FROM expenses WHERE id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)',
      [payment.id, ownerEmail]
    );
    assert.equal(unchangedPayment.rows[0].kind, 'expense');
    const savingsFund = await fetch(`${baseUrl}/api/savings`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Emergency fund', target_amount: 500 }),
    });
    assert.equal(savingsFund.status, 201);
    const fund = await savingsFund.json();
    const contribution = await fetch(`${baseUrl}/api/savings/${fund.id}/entries`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'save', amount: 125 }),
    });
    assert.equal(contribution.status, 201);
    const contributionEntry = await contribution.json();
    assert.equal(contributionEntry.kind, 'save');
    const rejectedWithdrawal = await fetch(`${baseUrl}/api/savings/${fund.id}/entries`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'withdraw', amount: 126 }),
    });
    assert.equal(rejectedWithdrawal.status, 409);
    const savingsList = await fetch(`${baseUrl}/api/savings`, { headers: headers(owner.body.token) });
    assert.equal(Number((await savingsList.json())[0].saved_amount), 125);
    const cashflow = await fetch(`${baseUrl}/api/money/cashflow`, {
      headers: headers(owner.body.token),
    });
    assert.equal(Number((await cashflow.json()).balance), 850);
    const backupResponse = await fetch(`${baseUrl}/api/export`, { headers: headers(owner.body.token) });
    const backup = await backupResponse.json();
    assert.equal(backup.version, 11);
    assert.equal(backup.account.username, owner.body.user.username);
    assert.equal(backup.account.avatar, null);
    const backupFund = backup.savings_funds.find((row) => row.export_key === fund.export_key);
    const backupEntry = backup.savings_fund_entries.find((row) => row.fund_key === fund.export_key);
    assert.ok(backupFund);
    assert.ok(backupEntry);
    const duplicateSavingsPreview = await fetch(`${baseUrl}/api/export/import/preview`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ savings_funds: [backupFund], savings_fund_entries: [backupEntry] }),
    });
    assert.equal(duplicateSavingsPreview.status, 200);
    const duplicateCounts = (await duplicateSavingsPreview.json()).counts;
    assert.equal(duplicateCounts.savings_funds.alreadyPresent, 1);
    assert.equal(duplicateCounts.savings_fund_entries.alreadyPresent, 1);
    const recoverySave = await fetch(`${baseUrl}/api/recovery`, {
      method: 'PUT',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_date: '2026-01-03', sleep_hours: 7.5, energy: 4, stress: 2, note: 'Rested' }),
    });
    assert.equal(recoverySave.status, 200);
    assert.equal((await recoverySave.json()).sleep_hours, '7.50');
    const recoveryRead = await fetch(`${baseUrl}/api/recovery?date=2026-01-03`, {
      headers: headers(owner.body.token),
    });
    assert.equal((await recoveryRead.json()).note, 'Rested');
    const alertSettings = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bill_due_enabled: true,
        bill_due_days_before: 3,
        bill_due_time: '09:15',
        agenda_enabled: true,
        agenda_time: '08:00',
        agenda_advance_enabled: true,
        agenda_advance_days_before: 2,
        agenda_advance_time: '18:45',
        low_balance_enabled: true,
        low_balance_threshold: 250,
        low_balance_time: '20:30',
      }),
    });
    assert.equal(alertSettings.status, 200);
    const savedAlertSettings = (await alertSettings.json()).settings;
    assert.equal(savedAlertSettings.bill_due_enabled, true);
    assert.equal(savedAlertSettings.bill_due_days_before, 3);
    assert.equal(savedAlertSettings.agenda_enabled, true);
    assert.equal(savedAlertSettings.agenda_time, '08:00');
    assert.equal(savedAlertSettings.agenda_advance_enabled, true);
    assert.equal(savedAlertSettings.agenda_advance_days_before, 2);
    assert.equal(savedAlertSettings.agenda_advance_time, '18:45');
    assert.equal(Number(savedAlertSettings.low_balance_threshold), 250);
    const invalidAlertSettings = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ bill_due_days_before: 8 }),
    });
    assert.equal(invalidAlertSettings.status, 400);
    const invalidAgendaTime = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda_time: '25:00' }),
    });
    assert.equal(invalidAgendaTime.status, 400);
    const invalidAdvanceLeadTime = await fetch(`${baseUrl}/api/notifications/settings`, {
      method: 'PUT',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda_advance_days_before: 8 }),
    });
    assert.equal(invalidAdvanceLeadTime.status, 400);
    const futureStrip = await fetch(`${baseUrl}/api/dashboard/strip?date=2027-01-01`, {
      headers: headers(owner.body.token),
    });
    assert.equal(futureStrip.status, 200);
    const futureStripBody = await futureStrip.json();
    assert.equal(futureStripBody.days.length, 7);
    assert.equal(futureStripBody.days[0].date, '2027-01-01');
    assert.equal(futureStripBody.days[6].date, '2027-01-07');

    const taskBody = { task_date: '2026-01-01', period: 'AM', title: 'Private task' };
    const idempotencyKey = crypto.randomUUID();
    const created = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        ...headers(owner.body.token),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(taskBody),
    });
    assert.equal(created.status, 201);
    const task = await created.json();

    const replay = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        ...headers(owner.body.token),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(taskBody),
    });
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).id, task.id);

    const conflictingReplay = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        ...headers(owner.body.token),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ ...taskBody, title: 'A different task' }),
    });
    assert.equal(conflictingReplay.status, 409);

    const importPreview = await fetch(`${baseUrl}/api/export/import/preview`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: [
          taskBody,
          { ...taskBody, task_date: '2026-01-02', title: 'New task from backup' },
          { ...taskBody, task_date: '2026-02-31', title: 'Invalid date task' },
        ],
      }),
    });
    assert.equal(importPreview.status, 200);
    const preview = await importPreview.json();
    assert.deepEqual(preview.counts.tasks, {
      toImport: 1,
      toOverwrite: 0,
      alreadyPresent: 1,
      unreadable: 1,
    });

    const scheduleItem = await fetch(`${baseUrl}/api/schedule`, {
      method: 'POST',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_date: '2026-01-03',
        title: 'Calendar owner item',
        start_time: '10:00',
        planned_minutes: 30,
      }),
    });
    assert.equal(scheduleItem.status, 201);
    const agendaItem = await scheduleItem.json();
    const patchAgenda = (body) => fetch(`${baseUrl}/api/schedule/${agendaItem.id}`, {
      method: 'PATCH',
      headers: { ...headers(owner.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const tooLongForDone = await patchAgenda({ status: 'done', actual_minutes: 31 });
    assert.equal(tooLongForDone.status, 400);
    const notLongEnoughForOvertime = await patchAgenda({ status: 'overtime', actual_minutes: 30 });
    assert.equal(notLongEnoughForOvertime.status, 400);

    const completedAgenda = await patchAgenda({ status: 'done', actual_minutes: 25 });
    assert.equal(completedAgenda.status, 200);
    assert.equal((await completedAgenda.json()).actual_minutes, 25);
    const pendingAgenda = await patchAgenda({ status: 'pending' });
    assert.equal(pendingAgenda.status, 200);
    assert.equal((await pendingAgenda.json()).actual_minutes, null);

    const overtimeAgenda = await patchAgenda({ status: 'overtime', actual_minutes: 45 });
    assert.equal(overtimeAgenda.status, 200);
    assert.equal((await overtimeAgenda.json()).actual_minutes, 45);
    const skippedAgenda = await patchAgenda({ status: 'skipped' });
    assert.equal(skippedAgenda.status, 200);
    assert.equal((await skippedAgenda.json()).actual_minutes, null);

    const calendar = await fetch(`${baseUrl}/api/schedule/export.ics?start=2026-01-01&end=2026-01-07`, {
      headers: headers(owner.body.token),
    });
    assert.equal(calendar.status, 200);
    assert.match(calendar.headers.get('content-type'), /text\/calendar/);
    assert.match(await calendar.text(), /SUMMARY:Calendar owner item/);

    const invalidCalendarRange = await fetch(`${baseUrl}/api/schedule/export.ics?start=2026-02-31&end=2026-03-01`, {
      headers: headers(owner.body.token),
    });
    assert.equal(invalidCalendarRange.status, 400);

    const otherTasks = await fetch(`${baseUrl}/api/tasks?date=2026-01-01`, {
      headers: headers(other.body.token),
    });
    assert.equal(otherTasks.status, 200);
    assert.deepEqual(await otherTasks.json(), []);

    const crossAccountEdit = await fetch(`${baseUrl}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { ...headers(other.body.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Changed by another account' }),
    });
    assert.equal(crossAccountEdit.status, 404);

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    await pool.query(
      `UPDATE users SET password_reset_token_hash=$1,
         password_reset_expires_at=now() + interval '1 hour' WHERE email=$2`,
      [resetTokenHash, ownerEmail]
    );
    const reset = await post('/api/auth/password/reset', {
      token: resetToken,
      password: 'a-new-reset-password',
    });
    assert.equal(reset.response.status, 200);

    const resetReplay = await post('/api/auth/password/reset', {
      token: resetToken,
      password: 'another-new-reset-password',
    });
    assert.equal(resetReplay.response.status, 400);

    const revokedSession = await fetch(`${baseUrl}/api/tasks?date=2026-01-01`, {
      headers: headers(owner.body.token),
    });
    assert.equal(revokedSession.status, 401);

    const resetLogin = await post('/api/auth/login', {
      email: ownerEmail,
      password: 'a-new-reset-password',
    });
    assert.equal(resetLogin.response.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[ownerEmail, otherEmail]]);
    await pool.end();
    if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrustProxy;
  }
});
