const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { pool } = require('../../db');

const testEmails = new Set();

async function setUniqueClientIp(context) {
  const clientIp = `198.51.100.${crypto.randomInt(1, 255)}`;
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': clientIp });
}

test.afterEach(async () => {
  if (testEmails.size) {
    await pool.query('DELETE FROM users WHERE email = ANY($1)', [[...testEmails]]);
    testEmails.clear();
  }
});

test.afterAll(async () => {
  await pool.end();
});

test('new user can sign up, add a task, and keep it after reload', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `browser-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(page.context());
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Browser test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('browser-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#main-screen')).toBeVisible();
  await page.waitForLoadState('networkidle');

  await page.getByRole('link', { name: /Tasks/ }).click();
  await page.waitForLoadState('networkidle');
  const taskName = `Browser task ${suffix}`;
  const form = page.locator('form[data-add="AM"]');
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  await form.locator('input[type="text"]').fill(taskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Api.queueCount())).toBe(0);

  await page.reload();
  await page.getByRole('link', { name: /Tasks/ }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();

  const overdueTask = `Carry-over ${suffix}`;
  const overdueDate = await page.evaluate(() => DateUtil.addDays(DateUtil.today(), -1));
  await page.evaluate(({ title, date }) => Api.post('/tasks', {
    task_date: date, period: 'AM', title, points: 10,
  }), { title: overdueTask, date: overdueDate });
  await page.evaluate((date) => { AppState.date = date; }, overdueDate);
  await page.getByRole('link', { name: /Goals/ }).click();
  await page.locator('#week-focus').fill('Make room for recovery');
  await page.locator('.rest-day-planner summary').click();
  await page.locator('[data-rest-day][value="0"]').check();
  await page.getByRole('button', { name: 'Save weekly plan' }).click();
  await expect(page.locator('#week-focus-saved')).toContainText('Focus saved');
  await page.locator('[data-move-item][data-move-kind="task"]').click();
  await expect(page.getByText(overdueTask, { exact: true })).toHaveCount(0);
  await page.reload();
  await page.evaluate((date) => { AppState.date = date; window.renderRoute(); }, overdueDate);
  await expect(page.locator('#week-focus')).toHaveValue('Make room for recovery');
  await expect(page.locator('[data-rest-day][value="0"]')).toBeChecked();
});

test('password reset form reads a token from the URL fragment and reports invalid tokens', async ({ page, context }) => {
  await setUniqueClientIp(context);
  await page.goto(`/#reset_token=${'a'.repeat(64)}`);
  await expect(page.locator('#password-reset-form')).toBeVisible();
  await page.locator('#reset-new-password').fill('browser-reset-password-long');
  await page.locator('#reset-confirm-password').fill('browser-reset-password-long');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.locator('#password-reset-error')).toContainText('invalid or has expired');
  await expect(page).toHaveURL(/\/$/);
});

test('safe offline creates and deletes queue and sync after reconnect; bill actions stay online-only', async ({ page, context }) => {
  const suffix = crypto.randomUUID();
  const email = `offline-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(context);
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Offline browser test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('offline-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name: /Tasks/ }).click();

  const form = page.locator('form[data-add="AM"]');
  await expect(form).toBeVisible();
  const savedTaskName = `Saved online task ${suffix}`;
  await form.locator('input[type="text"]').fill(savedTaskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(savedTaskName, { exact: true })).toBeVisible();

  await context.setOffline(true);
  const taskName = `Offline task ${suffix}`;
  await form.locator('input[type="text"]').fill(taskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('#connectivity-status')).toContainText('1 queued change');
  const cachedTasks = await page.evaluate(() => Api.get(`/tasks?date=${DateUtil.today()}`));
  expect(cachedTasks.some((task) => task.title === savedTaskName)).toBe(true);
  await expect(page.locator('#connectivity-status')).toContainText('Showing saved data');
  await page.getByRole('button', { name: 'Review queued changes' }).click();
  await expect(page.getByRole('dialog')).toContainText('POST /tasks');
  await page.getByRole('button', { name: 'Close' }).click();

  await context.setOffline(false);
  await expect(page.locator('#connectivity-status')).toBeHidden({ timeout: 10000 });
  await page.reload();
  await page.getByRole('link', { name: /Tasks/ }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  const taskId = await page.locator('[data-del]').first().getAttribute('data-del');
  await context.setOffline(true);
  // Simple deletes now queue too and sync later.
  const deleteWasQueued = await page.evaluate(async (id) => (await Api.del(`/tasks/${id}`)).queued === true, taskId);
  expect(deleteWasQueued).toBe(true);
  expect(await page.evaluate(() => Api.queueCount())).toBe(1);
  // Bill payments and other multi-step actions still need a live server.
  const billActionWasRejected = await page.evaluate(async () => {
    try {
      await Api.del('/money/bills/1/pay?month=2026-01-01');
      return false;
    } catch {
      return true;
    }
  });
  expect(billActionWasRejected).toBe(true);
  expect(await page.evaluate(() => Api.queueCount())).toBe(1);

  await context.setOffline(false);
  await expect(page.locator('#connectivity-status')).toBeHidden({ timeout: 20000 });
  expect(await page.evaluate(() => Api.queueCount())).toBe(0);
});

test('calendar import previews events, adds them once, and skips duplicates', async ({ page, context }) => {
  const suffix = crypto.randomUUID();
  const email = `calendar-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(context);
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Calendar import test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('calendar-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('link', { name: /Agenda/ }).click();

  const now = new Date();
  const eventDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const calendar = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART;VALUE=DATE:${eventDate}`,
    `SUMMARY:Imported planning ${suffix}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  await page.locator('#calendar-file').setInputFiles({
    name: 'planning.ics',
    mimeType: 'text/calendar',
    buffer: Buffer.from(calendar),
  });
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.locator('#calendar-preview')).toContainText('1 new event');
  await page.getByRole('button', { name: 'Add these events' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(`Imported planning ${suffix}`, { exact: true })).toBeVisible();

  // The agenda re-renders after an import, which clears the file picker and any preview.
  // Retry choosing the file and previewing until a render does not interrupt it.
  await expect(async () => {
    await page.locator('#calendar-file').setInputFiles({
      name: 'planning.ics',
      mimeType: 'text/calendar',
      buffer: Buffer.from(calendar),
    });
    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(page.locator('#calendar-preview')).toContainText('0 new events; 1 already present', { timeout: 3000 });
  }).toPass({ timeout: 20000 });
});

test('bill payment and recovery check-in are saved and can be undone or cleared', async ({ page, context }) => {
  const suffix = crypto.randomUUID();
  const email = `money-recovery-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(context);
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Money and recovery test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('money-recovery-test-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByRole('link', { name: /Money/ }).click();
  const billTitle = `E2E bill ${suffix}`;
  await page.locator('#bill-title').fill(billTitle);
  await page.locator('#bill-amount').fill('25');
  await page.locator('#bill-due-day').fill('31');
  await page.getByRole('button', { name: 'Add monthly bill' }).click();
  await expect(page.locator('.bill-row .title')).toContainText(billTitle);
  await page.getByRole('button', { name: 'Mark paid' }).click();
  const statusChip = page.locator('.bill-occurrence-row .pts-chip');
  await expect(statusChip).toHaveText('Paid');
  await expect(page.locator('.bill-occurrence-row').getByRole('button', { name: 'Undo payment' })).toBeVisible();
  await page.locator('.bill-occurrence-row').getByRole('button', { name: 'Undo payment' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(statusChip).toHaveText('Unpaid');

  await page.locator('#savings-fund-title').fill(`E2E fund ${suffix}`);
  await page.locator('#savings-fund-target').fill('500');
  await page.getByRole('button', { name: 'Create savings fund' }).click();
  const fundRow = page.locator('.savings-fund-row').filter({ hasText: `E2E fund ${suffix}` });
  await fundRow.getByRole('button', { name: 'Set aside' }).click();
  await page.getByRole('dialog').locator('input').fill('50');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.savings-fund-row').filter({ hasText: `E2E fund ${suffix}` }))
    .toContainText('₱50.00 of ₱500.00');

  await page.getByRole('link', { name: /Goals/ }).click();
  await page.locator('#recovery-sleep-hours').fill('7.5');
  await page.locator('#recovery-energy').selectOption('4');
  await page.locator('#recovery-stress').selectOption('2');
  await page.locator('#recovery-note').fill('E2E recovery note');
  await page.getByRole('button', { name: 'Save check-in' }).click();
  await expect(page.locator('#recovery-note')).toHaveValue('E2E recovery note');
  await page.getByRole('button', { name: 'Clear check-in' }).click();
  await expect(page.getByRole('button', { name: 'Clear check-in' })).toHaveCount(0);
});

async function signUpFresh(page, context, label) {
  const suffix = crypto.randomUUID();
  const email = `${label}-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(context);
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill(`${label} test`);
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill(`${label}-test-password-long-enough`);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#main-screen')).toBeVisible();
  return { suffix, email };
}

test('installed app reopens offline from its saved copy and says how old that copy is', async ({ page, context }) => {
  const { suffix } = await signUpFresh(page, context, 'reopen');
  await page.getByRole('link', { name: /Tasks/ }).click();
  const form = page.locator('form[data-add="AM"]');
  const taskName = `Saved before going offline ${suffix}`;
  await form.locator('input[type="text"]').fill(taskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // The service worker must be controlling the page, and the app shell must be cached.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await page.reload(); // reload once online so this tab's own requests are the cached ones

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#main-screen')).toBeVisible();
  await page.getByRole('link', { name: /Tasks/ }).click();
  await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  await expect(page.locator('#connectivity-status')).toContainText('Showing saved data');
  await expect(page.locator('#connectivity-status')).toContainText('was saved');

  await context.setOffline(false);
  await expect(page.locator('#connectivity-status')).toBeHidden({ timeout: 20000 });
});

test('a change the server refuses is held for review while valid changes still sync', async ({ page, context }) => {
  const { suffix } = await signUpFresh(page, context, 'rejected');
  await page.getByRole('link', { name: /Tasks/ }).click();
  await page.waitForLoadState('networkidle');

  await context.setOffline(true);
  const validTitle = `Valid offline ${suffix}`;
  const queued = await page.evaluate(async (title) => {
    const day = DateUtil.today();
    const bad = await Api.post('/tasks', { task_date: day, period: 'AM' }); // no title: the server refuses it
    const good = await Api.post('/tasks', { task_date: day, period: 'PM', title, points: 10 });
    return [bad.queued, good.queued];
  }, validTitle);
  expect(queued).toEqual([true, true]);
  await expect(page.locator('#connectivity-status')).toContainText('2 queued changes');

  await context.setOffline(false);
  // The valid change syncs; the refused one stays behind and the banner says so.
  await expect(page.locator('#connectivity-status')).toContainText('1 offline change is waiting to sync', { timeout: 20000 });
  await page.getByRole('button', { name: 'Review queued changes' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('HTTP 400');
  await expect(dialog).toContainText('title are required');
  await dialog.getByRole('button', { name: 'Remove this change' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('#connectivity-status')).toBeHidden({ timeout: 10000 });
  expect(await page.evaluate(() => Api.queueCount())).toBe(0);

  const titles = await page.evaluate(async () => (await Api.get(`/tasks?date=${DateUtil.today()}`)).map((task) => task.title));
  expect(titles).toContain(validTitle);
});

test('encrypted export hides entries and is never kept in the offline copy', async ({ page, context }) => {
  const { suffix, email } = await signUpFresh(page, context, 'backup');
  await page.getByRole('link', { name: /Tasks/ }).click();
  const secretTask = `Private task ${suffix}`;
  const form = page.locator('form[data-add="AM"]');
  await form.locator('input[type="text"]').fill(secretTask);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(secretTask, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Settings/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-data').click();
  const passphrase = 'correct horse battery staple';
  await page.locator('.modal input[type="password"]').last().fill(passphrase);
  await page.locator('.modal [data-ok]').last().click();
  await expect(page.getByText('Confirm backup passphrase')).toBeVisible();
  await page.locator('.modal input[type="password"]').last().fill(passphrase);
  await page.locator('.modal [data-ok]').last().click();
  const download = await downloadPromise;

  const fs = require('fs');
  const text = fs.readFileSync(await download.path(), 'utf8');
  const backup = JSON.parse(text);
  expect(backup.format).toBe('small-wins-encrypted-backup');
  expect(backup.cipher).toBe('AES-256-GCM');
  expect(text).not.toContain(secretTask);
  expect(text).not.toContain(email);

  const cachedPaths = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('selfup-offline');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const all = open.result.transaction('responses', 'readonly').objectStore('responses').getAll();
      all.onsuccess = () => { open.result.close(); resolve(all.result.map((record) => record.path)); };
      all.onerror = () => reject(all.error);
    };
  }));
  expect(cachedPaths.length).toBeGreaterThan(0);
  expect(cachedPaths.some((path) => path.startsWith('/export'))).toBe(false);
});

test('first-run screen explains where data lives and offers sample entries', async ({ page, context }) => {
  await setUniqueClientIp(context);
  await page.goto('/');
  await expect(page.locator('#auth-data-note')).toContainText('local app');

  await signUpFresh(page, context, 'sample');
  const onboarding = page.locator('.onboarding');
  await expect(onboarding).toBeVisible();
  await onboarding.getByRole('button', { name: 'Explore with sample entries' }).click();
  await expect(page.locator('.onboarding')).toHaveCount(0);

  await page.getByRole('link', { name: /Tasks/ }).click();
  await expect(page.getByText('Sample: plan a calm start', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Settings/ }).click();
  await expect(page.locator('#data-location')).toContainText('Stored on this computer');
  await expect(page.locator('#sample-data-status')).toContainText('example entries are currently loaded');
});
