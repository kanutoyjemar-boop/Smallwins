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

test('password fields can be shown and hidden on authentication forms', async ({ page }) => {
  await page.goto('/');
  const loginPassword = page.locator('#login-password');
  await expect(loginPassword).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).first().click();
  await expect(loginPassword).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password' }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hide password' }).first().click();
  await expect(loginPassword).toHaveAttribute('type', 'password');

  await page.getByRole('link', { name: 'Create one' }).click();
  const signupPassword = page.locator('#signup-password');
  await page.getByRole('button', { name: 'Show password' }).last().click();
  await expect(signupPassword).toHaveAttribute('type', 'text');
});

test('profile picture is saved and visible across every app tab', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `avatar-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(page.context());
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Avatar test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('avatar-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#main-screen')).toBeVisible();
  await page.goto('/#/settings');
  const imageBuffer = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#e8b54d';
    context.fillRect(0, 0, 2, 2);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.locator('#profile-picture-file').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: imageBuffer,
  });
  await expect(page.getByRole('button', { name: 'Save picture' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save picture' }).click();
  const profileImage = page.locator('#profile-avatar-image');
  await expect(profileImage).toBeVisible();
  await expect(profileImage).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  const backup = await page.evaluate(() => Api.get('/export'));
  expect(backup.account.username).toMatch(/^avatar_test_[a-f0-9]+$/);
  expect(backup.account.avatar).toMatch(/^data:image\/jpeg;base64,/);
  const invalidAvatarError = await page.evaluate(async () => {
    try {
      await Api.patch('/auth/me', { avatar: 'data:image/svg+xml;base64,PHN2Zy8+' });
      return '';
    } catch (error) {
      return error.message;
    }
  });
  expect(invalidAvatarError).toBe('Profile picture must be a JPEG image no larger than 256 KB.');

  await page.reload();
  await expect(profileImage).toBeVisible();
  await page.locator('.desktop-sidebar a[data-route="/"]').click();
  await page.locator('.dashboard-secondary summary').click();
  await expect(page.locator('#share-preview canvas')).toBeVisible();
  const pdfPopupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Save as PDF' }).click();
  const pdfPage = await pdfPopupPromise;
  await expect(pdfPage.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(pdfPage.locator('img')).toHaveAttribute('alt', /@avatar_test_/);
  await pdfPage.close();
  for (const route of ['#/', '#/tasks', '#/money', '#/body', '#/schedule', '#/stats', '#/goals']) {
    await page.locator(`.desktop-sidebar a[data-route="${route.slice(1)}"]`).click();
    await expect(profileImage).toBeVisible();
  }

  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Remove picture' }).click();
  await expect(profileImage).toBeHidden();
  await expect(page.locator('#profile-avatar-initials')).toBeVisible();
});

test('advance agenda reminders can be configured from Settings', async ({ page }) => {
  const email = `agenda-reminder-${crypto.randomUUID()}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(page.context());
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Agenda reminder test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('agenda-reminder-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#main-screen')).toBeVisible();

  await page.goto('/#/settings');
  await page.locator('#agenda-advance-enabled').check();
  await page.locator('#agenda-advance-days-before').selectOption('3');
  await page.locator('#agenda-advance-time').fill('19:15');
  await page.getByRole('button', { name: 'Save reminder settings' }).click();
  await expect(page.locator('#settings-saved')).toHaveText('Saved.');

  const { settings } = await page.evaluate(() => Api.get('/notifications/settings'));
  expect(settings.agenda_advance_enabled).toBe(true);
  expect(settings.agenda_advance_days_before).toBe(3);
  expect(settings.agenda_advance_time).toBe('19:15');
});

test('dashboard shows daily priorities and prioritizes every upcoming event', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `upcoming-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(page.context());
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Upcoming test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('upcoming-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#main-screen')).toBeVisible();
  await expect(page.locator('.dashboard-date-controls .greeting h2')).toBeVisible();
  await expect(page.locator('.dashboard-date-controls .greeting p')).toContainText('Small steps add up over time');
  await expect(page.locator('.score-hero .rating-label')).toHaveText('A fresh start');
  const dailyStats = page.locator('.dashboard-date-content .stat-grid');
  await expect(dailyStats).toBeVisible();
  await expect(dailyStats.locator('.stat-card')).toHaveCount(4);
  await expect(dailyStats).toContainText('Tasks');
  await expect(dailyStats).toContainText('Money spent');
  await expect(dailyStats).toContainText('Body & meals');
  await expect(dailyStats).toContainText('Agenda');
  await page.locator('[data-skip-onboarding]').click();
  await expect(page.locator('.home-next-step')).toContainText('Start with one small win');
  await expect(page.locator('.home-next-actions a')).toHaveCount(2);

  const { nearDate, farDate } = await page.evaluate(() => ({
    nearDate: DateUtil.addDays(DateUtil.today(), 1),
    farDate: DateUtil.addDays(DateUtil.today(), 12),
  }));
  await page.evaluate(async ({ nearDate, farDate }) => {
    await Api.post('/schedule', { item_date: farDate, title: 'Later appointment', start_time: '10:00' });
    await Api.post('/schedule', { item_date: nearDate, title: 'Sooner late appointment', start_time: '10:00' });
    await Api.post('/schedule', { item_date: nearDate, title: 'Sooner appointment', start_time: '08:00' });
  }, { nearDate, farDate });
  await page.reload();
  await page.locator('.desktop-sidebar a[data-route="/"]').click();
  const upcomingItems = page.locator('.upcoming-event');
  await expect(upcomingItems).toHaveCount(3);
  await expect(upcomingItems.nth(0)).toContainText('Sooner appointment');
  await expect(upcomingItems.nth(0)).toContainText('NEXT');
  await expect(upcomingItems.nth(1)).toContainText('Sooner late appointment');
  await expect(upcomingItems.nth(2)).toContainText('Later appointment');
  await upcomingItems.nth(0).click();
  await expect(page.locator('#schedule-date')).toHaveValue(nearDate);
});

test('quick add clearly labels task and expense fields and saves them', async ({ page }) => {
  const suffix = crypto.randomUUID();
  const email = `quick-add-${suffix}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(page.context());
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Quick add test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('quick-add-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#main-screen')).toBeVisible();

  await page.getByRole('button', { name: 'Quick add' }).click();
  const dialog = page.getByRole('dialog', { name: 'Quick add' });
  await expect(dialog).toContainText(`For ${await page.evaluate(() => DateUtil.label(AppState.date))}`);
  await expect(dialog.locator('#qa-title')).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Task name suggestions' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Take a short walk' }).click();
  await expect(dialog.locator('#qa-title')).toHaveValue('Take a short walk');
  await expect(dialog.getByLabel('When?')).toHaveValue('AM');
  await expect(dialog.getByLabel('Points (10 by default)')).toHaveValue('10');
  await dialog.getByRole('button', { name: 'Close quick add' }).click();
  await expect(dialog).toHaveCount(0);

  const taskName = `Quick task ${suffix}`;
  await page.getByRole('button', { name: 'Quick add' }).click();
  await page.locator('#qa-title').fill(taskName);
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await expect(page.locator('.list-item .title').filter({ hasText: taskName })).toBeVisible();
  const taskSuggestionGroup = page.getByRole('group', { name: 'Morning task suggestions' });
  await expect(taskSuggestionGroup).toContainText(taskName);
  await taskSuggestionGroup.getByRole('button', { name: taskName, exact: true }).click();
  await expect(page.locator('#task-title-AM')).toHaveValue(taskName);

  const expenseName = `Quick expense ${suffix}`;
  await page.getByRole('button', { name: 'Quick add' }).click();
  const expenseTab = page.getByRole('button', { name: 'Expense', exact: true });
  await expenseTab.click();
  await expect(expenseTab).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Expense name suggestions' })).toBeVisible();
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
  await expect(page.getByLabel('What was the expense?')).toHaveValue('Groceries');
  await page.getByLabel('What was the expense?').fill(expenseName);
  await page.getByLabel('Amount (₱)').fill('125');
  await page.getByRole('button', { name: 'Log expense' }).click();
  await page.locator('.desktop-sidebar a[data-route="/money"]').click();
  await expect(page.locator('.list-item .title').filter({ hasText: expenseName })).toBeVisible();
});

test('refreshing the current page does not replay its route animation', async ({ page }) => {
  const email = `motion-${crypto.randomUUID()}@example.test`;
  testEmails.add(email);
  await setUniqueClientIp(page.context());
  await page.goto('/');
  await page.getByRole('link', { name: 'Create one' }).click();
  await page.locator('#signup-name').fill('Motion test');
  await page.locator('#signup-email').fill(email);
  await page.locator('#signup-password').fill('motion-test-password-long-enough');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('.dashboard-date-controls .greeting h2')).toBeVisible();
  await expect(page.locator('#content')).not.toHaveClass(/route-enter/);

  const replayedRouteAnimation = await page.evaluate(() => new Promise((resolve) => {
    const content = document.getElementById('content');
    let replayed = false;
    const observer = new MutationObserver((records) => {
      if (content.classList.contains('route-enter')) replayed = true;
      if (records.some((record) => record.type === 'childList')) {
        observer.disconnect();
        resolve(replayed);
      }
    });
    observer.observe(content, { attributes: true, attributeFilter: ['class'], childList: true });
    window.renderRoute();
    setTimeout(() => {
      observer.disconnect();
      resolve(replayed);
    }, 3000);
  }));
  expect(replayedRouteAnimation).toBe(false);
});

test('reduced-motion preference limits animations to one brief pass', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const motion = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'skeleton';
    document.body.appendChild(probe);
    const styles = getComputedStyle(probe);
    const result = { duration: styles.animationDuration, iterations: styles.animationIterationCount };
    probe.remove();
    return result;
  });
  expect(Number.parseFloat(motion.duration)).toBeLessThan(0.001);
  expect(motion.iterations).toBe('1');
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

  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await page.waitForLoadState('networkidle');
  const taskName = `Browser task ${suffix}`;
  const form = page.locator('form[data-add="AM"]');
  await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }));
  await form.locator('input[type="text"]').fill(taskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.list-item .title').filter({ hasText: taskName })).toBeVisible();
  expect(await page.evaluate(() => Api.queueCount())).toBe(0);

  await page.reload();
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await expect(page.locator('.list-item .title').filter({ hasText: taskName })).toBeVisible();

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
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();

  const form = page.locator('form[data-add="AM"]');
  await expect(form).toBeVisible();
  const savedTaskName = `Saved online task ${suffix}`;
  await form.locator('input[type="text"]').fill(savedTaskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.list-item .title').filter({ hasText: savedTaskName })).toBeVisible();

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
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await expect(page.locator('.list-item .title').filter({ hasText: taskName })).toBeVisible();
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
  await page.locator('.desktop-sidebar a[data-route="/schedule"]').click();

  const eventDate = await page.evaluate(() => DateUtil.today().replace(/-/g, ''));
  const eventDateKey = `${eventDate.slice(0, 4)}-${eventDate.slice(4, 6)}-${eventDate.slice(6, 8)}`;
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
  await page.locator(`.mini-day[data-date="${eventDateKey}"]`).click();
  await expect(page.locator('.agenda-item .title').filter({ hasText: `Imported planning ${suffix}` })).toBeVisible();

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

test('mobile navigation keeps common sections visible and reveals the rest from More', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signUpFresh(page, context, 'mobile-navigation');

  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const more = nav.getByRole('button', { name: 'More' });
  const menu = page.getByRole('navigation', { name: 'More sections' });
  await expect(nav.getByRole('link')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(await nav.getByRole('link').first().evaluate((link) => link.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(menu).toBeHidden();

  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: 'Body' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  await menu.getByRole('link', { name: 'Body' }).click();
  await expect(page.locator('#content .body-hero')).toBeVisible();
  await expect(page.locator('#content')).toBeFocused();
  await expect(menu).toBeHidden();
  await expect(more).toHaveClass(/active/);
});

test('installed app reopens offline from its saved copy and says how old that copy is', async ({ page, context }) => {
  const { suffix } = await signUpFresh(page, context, 'reopen');
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  const form = page.locator('form[data-add="AM"]');
  const taskName = `Saved before going offline ${suffix}`;
  await form.locator('input[type="text"]').fill(taskName);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.list-item .title').filter({ hasText: taskName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('selfup-offline');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('account', 'readonly').objectStore('account').get(String(Api.getUser().id));
      request.onsuccess = () => {
        open.result.close();
        resolve((request.result && request.result.data.tasks || []).map((task) => task.title));
      };
      request.onerror = () => reject(request.error);
    };
  }))).toContain(taskName);
  const cachedSections = [
    { route: '/money', selector: '.money-hero' },
    { route: '/body', selector: '.body-hero' },
    { route: '/schedule', selector: '.schedule-week-controls' },
    { route: '/stats', selector: '.score-hero' },
    { route: '/goals', selector: '.weekly-review-panel' },
    { route: '/', selector: '.dashboard-page' },
  ];
  for (const { route, selector } of cachedSections) {
    await page.locator(`a[data-route="${route}"]`).click();
    await expect(page.locator(`#content ${selector}`)).toBeVisible();
  }
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await page.waitForLoadState('networkidle');

  // The service worker must be controlling the page, and the app shell must be cached.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  await page.reload(); // reload once online so this tab's own requests are the cached ones

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#main-screen')).toBeVisible();
  const offlineDashboardData = await page.evaluate(async () => {
    const date = DateUtil.today();
    const month = date.slice(0, 7);
    const [dashboard, monthly, week, totals] = await Promise.all([
      Api.get(`/dashboard?date=${date}`),
      Api.get(`/dashboard/monthly?month=${month}`),
      Api.get(`/dashboard/week?date=${date}`),
      Api.get('/dashboard/totals'),
    ]);
    return { date, dashboard, monthly, week, totals };
  });
  expect(offlineDashboardData.dashboard.summary).toHaveProperty('percentage');
  expect(offlineDashboardData.dashboard.summary.percentage).toBe(0);
  expect(offlineDashboardData.monthly.days.find((day) => day.date === offlineDashboardData.date).percentage).toBe(0);
  expect(offlineDashboardData.week).toHaveProperty('previousWeekly');
  expect(offlineDashboardData.week).toHaveProperty('pendingAgenda');
  expect(offlineDashboardData.totals).toHaveProperty('xpPerLevel', 500);
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await expect(page.locator('.list-item .title').filter({ hasText: taskName })).toBeVisible();
  await expect(page.locator('#connectivity-status')).toContainText('Showing saved data');
  await expect(page.locator('#connectivity-status')).toContainText('was saved');
  const savedAccountTasks = await page.evaluate(async () => (await Api.get('/export')).tasks.map((task) => task.title));
  expect(savedAccountTasks).toContain(taskName);
  for (const { route, selector } of cachedSections.slice().reverse()) {
    await page.locator(`a[data-route="${route}"]`).click();
    await expect(page.locator(`#content ${selector}`)).toBeVisible();
    await expect(page.locator('#content')).not.toContainText('This data is not saved on this device yet.');
  }

  await context.setOffline(false);
  await expect(page.locator('#connectivity-status')).toBeHidden({ timeout: 20000 });
  const userId = await page.evaluate(() => String(Api.getUser().id));
  await page.locator('.desktop-sidebar a[data-route="/settings"]').click();
  await page.locator('#settings-logout').click();
  await expect(page.locator('#auth-screen')).toBeVisible();
  await expect.poll(() => page.evaluate((id) => new Promise((resolve, reject) => {
    const open = indexedDB.open('selfup-offline');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('account', 'readonly').objectStore('account').get(id);
      request.onsuccess = () => { open.result.close(); resolve(Boolean(request.result)); };
      request.onerror = () => reject(request.error);
    };
  }), userId)).toBe(false);
});

test('a change the server refuses is held for review while valid changes still sync', async ({ page, context }) => {
  const { suffix } = await signUpFresh(page, context, 'rejected');
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
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

test('encrypted exports stay out of page cache while full account copy is stored separately', async ({ page, context }) => {
  const { suffix, email } = await signUpFresh(page, context, 'backup');
  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  const secretTask = `Private task ${suffix}`;
  const form = page.locator('form[data-add="AM"]');
  await form.locator('input[type="text"]').fill(secretTask);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.list-item .title').filter({ hasText: secretTask })).toBeVisible();

  await page.locator('.desktop-sidebar a[data-route="/settings"]').click();
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

  const localCopy = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('selfup-offline');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result.transaction('account', 'readonly').objectStore('account').get(String(Api.getUser().id));
      request.onsuccess = () => { open.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }));
  expect(localCopy.data.tasks.some((task) => task.title === secretTask)).toBe(true);
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

  await page.locator('.desktop-sidebar a[data-route="/tasks"]').click();
  await expect(page.locator('.list-item .title').filter({ hasText: 'Sample: plan a calm start' })).toBeVisible();

  await page.locator('.desktop-sidebar a[data-route="/settings"]').click();
  await expect(page.locator('#data-location')).toContainText('Stored on this computer');
  await expect(page.locator('#sample-data-status')).toContainText('example entries are currently loaded');
});
