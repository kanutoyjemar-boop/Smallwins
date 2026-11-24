const Api = (() => {
  const TOKEN_KEY = 'selfup_token';
  const USER_KEY = 'selfup_user';
  const LAST_SYNC_PREFIX = 'selfup_last_sync_';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function lastSyncKey() {
    const user = getUser();
    return user ? `${LAST_SYNC_PREFIX}${user.id}` : null;
  }
  function markLastSync() {
    const key = lastSyncKey();
    if (key) localStorage.setItem(key, String(Date.now()));
  }
  function lastSyncTime() {
    const key = lastSyncKey();
    const value = key ? Number(localStorage.getItem(key)) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  // When the saved login expires (ms since epoch), or null if unknown. Offline use keeps
  // working after expiry, but syncing needs a fresh login once the device is online.
  function tokenExpiry() {
    try {
      const payload = getToken().split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const { exp } = JSON.parse(atob(payload));
      return exp ? exp * 1000 : null;
    } catch { return null; }
  }

  function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function clearSession() {
    const user = getUser();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (user && 'indexedDB' in window) {
      return clearLocalData(String(user.id)).catch((error) => {
        console.warn('Could not clear this account\'s offline data:', error);
      });
    }
    return Promise.resolve();
  }

  const QUEUE_DB = 'selfup-offline';
  const QUEUE_STORE = 'mutations';
  const RESPONSE_STORE = 'responses';
  const ACCOUNT_STORE = 'account';
  const QUEUEABLE_PATH = /^\/(tasks|workouts|diet|money|schedule|goals|recurring|preferences|reflections|templates|savings|recovery)(\/|$)|^\/dashboard\/week\/(focus|checkin)$/;
  // Full-account copies use their own store; they are never mixed into page-response cache.
  const NEVER_CACHE = /^\/(export|offline-copy)(\/|\?|$)/;
  let flushing = null;
  let localCopySyncing = null;
  let localCopyRefreshTimer = null;
  let offlineCacheWarningShown = false;

  function openQueue() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(QUEUE_DB, 3);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(QUEUE_STORE)) {
          database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(RESPONSE_STORE)) {
          database.createObjectStore(RESPONSE_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(ACCOUNT_STORE)) {
          database.createObjectStore(ACCOUNT_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function withStore(name, mode, action) {
    return openQueue().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction(name, mode);
      const result = action(transaction.objectStore(name));
      transaction.oncomplete = () => { database.close(); resolve(result.result); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    }));
  }

  function withQueueStore(mode, action) {
    return withStore(QUEUE_STORE, mode, action);
  }

  function withResponseStore(mode, action) {
    return withStore(RESPONSE_STORE, mode, action);
  }

  function withAccountStore(mode, action) {
    return withStore(ACCOUNT_STORE, mode, action);
  }

  function responseCacheId(userId, path) {
    return `${userId}:${path}`;
  }

  function readLocalCopy(userId) {
    return withAccountStore('readonly', (store) => store.get(String(userId)));
  }

  async function saveLocalCopy(userId, data, token = getToken()) {
    const user = getUser();
    if (getToken() !== token || !user || String(user.id) !== String(userId)) return null;
    const savedAt = Date.now();
    await withAccountStore('readwrite', (store) => store.put({
      id: String(userId),
      userId: String(userId),
      data,
      savedAt,
    }));
    window.dispatchEvent(new CustomEvent('selfup:local-copy', { detail: { savedAt } }));
    return savedAt;
  }

  async function getOfflineAccountCopy(userId) {
    let cached;
    try {
      cached = await readLocalCopy(userId);
    } catch (error) {
      throw new Error(`Could not reach the server or read the saved account copy: ${error.message}`);
    }
    if (!cached) {
      throw new Error('A complete account copy is not saved on this device yet. Connect to download it for offline use.');
    }
    window.dispatchEvent(new CustomEvent('selfup:cached-data', { detail: { savedAt: cached.savedAt || null } }));
    return cached.data;
  }

  function readCachedResponse(userId, path) {
    return withResponseStore('readonly', (store) => store.get(responseCacheId(userId, path)));
  }

  async function cacheResponse(userId, path, data) {
    try {
      await withResponseStore('readwrite', (store) => store.put({
        id: responseCacheId(userId, path),
        userId,
        path,
        data,
        savedAt: Date.now(),
      }));
    } catch (error) {
      if (!offlineCacheWarningShown && typeof UI !== 'undefined') {
        offlineCacheWarningShown = true;
        UI.toast(`Could not save an offline copy: ${error.message}`);
      }
    }
  }

  async function clearLocalData(userId) {
    const records = await withResponseStore('readonly', (store) => store.getAll());
    const mine = records.filter((record) => record.userId === userId);
    if (mine.length) {
      await withResponseStore('readwrite', (store) => {
        return mine.reduce((last, record) => store.delete(record.id), null);
      });
    }
    await withAccountStore('readwrite', (store) => store.delete(userId));
  }

  async function refreshLocalCopy({ maxAgeMs = 0 } = {}) {
    const token = getToken();
    const user = token ? getUser() : null;
    if (!token || !user) return { synced: false };
    if (!('indexedDB' in window)) throw new Error('This browser does not support on-device data storage.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { synced: false, offline: true };

    const userId = String(user.id);
    if (maxAgeMs > 0) {
      const cached = await readLocalCopy(userId);
      if (cached && Date.now() - cached.savedAt < maxAgeMs) return { synced: false, savedAt: cached.savedAt };
    }
    if (localCopySyncing) return localCopySyncing;

    localCopySyncing = (async () => {
      const response = await fetch('/api/offline-copy', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (response.status === 401) {
        clearSession();
        if (typeof UI !== 'undefined') UI.toast('Session expired — please log in again');
        if (window.showAuth) showAuth();
        throw new Error('Session expired.');
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Could not sync the device copy (HTTP ${response.status}).`);
      }
      const data = await response.json();
      if (!data || !data.account || !Array.isArray(data.tasks)) {
        throw new Error('The server returned an invalid account copy.');
      }
      const savedAt = await saveLocalCopy(userId, data, token);
      if (!savedAt) return { synced: false, sessionChanged: true };
      markLastSync();
      return { synced: true, savedAt };
    })().finally(() => { localCopySyncing = null; });
    return localCopySyncing;
  }

  function scheduleLocalCopyRefresh() {
    if (localCopyRefreshTimer) clearTimeout(localCopyRefreshTimer);
    localCopyRefreshTimer = setTimeout(() => {
      localCopyRefreshTimer = null;
      refreshLocalCopy().catch((error) => {
        if (typeof UI !== 'undefined') UI.toast(`Could not sync the device copy: ${error.message}`);
        else console.warn('Could not sync the device copy:', error);
      });
    }, 1000);
  }

  const NO_OFFLINE_RESPONSE = Symbol('no-offline-response');

  function localDate(value) {
    return String(value || '').slice(0, 10);
  }

  function accountRecordsForRange(records, start, end, dateField) {
    return records.filter((record) => {
      const date = localDate(record[dateField]);
      return date >= start && date <= end;
    });
  }

  function localMoneySummary(snapshot, query) {
    const date = query.get('date') || DateUtil.today();
    const range = query.get('range') || 'month';
    const dateValue = new Date(`${date}T00:00:00`);
    let start = date;
    let end = date;
    if (range === 'week') start = DateUtil.addDays(date, -6);
    else if (range === 'month') {
      start = `${date.slice(0, 7)}-01`;
      end = `${date.slice(0, 7)}-${String(new Date(dateValue.getFullYear(), dateValue.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
    } else if (range === 'year') {
      start = `${date.slice(0, 4)}-01-01`;
      end = `${date.slice(0, 4)}-12-31`;
    }

    const transactions = accountRecordsForRange(snapshot.expenses || [], start, end, 'expense_date')
      .sort((a, b) => localDate(b.expense_date).localeCompare(localDate(a.expense_date)) || Number(b.id) - Number(a.id));
    const income = transactions.filter((row) => row.kind === 'income').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expenses = transactions.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const net = income - expenses;
    const byDate = new Map();
    const byCategory = new Map();
    for (const row of transactions) {
      const day = localDate(row.expense_date);
      if (!byDate.has(day)) byDate.set(day, { date: day, income: 0, expense: 0, net: 0 });
      const point = byDate.get(day);
      if (row.kind === 'income') point.income += Number(row.amount || 0);
      else {
        point.expense += Number(row.amount || 0);
        const category = row.category || 'Other';
        byCategory.set(category, (byCategory.get(category) || 0) + Number(row.amount || 0));
      }
      point.net = point.income - point.expense;
    }
    const trend = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const categories = [...byCategory.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
    return {
      range,
      start,
      end,
      income,
      expenses,
      net,
      savingsRate: income > 0 ? Math.round((net / income) * 100) : 0,
      spendingDays: transactions.filter((row) => row.kind === 'expense').length,
      averageDailySpend: trend.length ? Math.round((expenses / trend.length) * 100) / 100 : 0,
      averageDailyIncome: trend.length ? Math.round((income / trend.length) * 100) / 100 : 0,
      trend,
      categories,
      transactions,
    };
  }

  function localMoneyCashflow(snapshot, date) {
    const month = `${date.slice(0, 7)}-01`;
    const monthExpenses = accountRecordsForRange(snapshot.expenses || [], month, date, 'expense_date');
    const income = monthExpenses.filter((row) => row.kind === 'income').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const expenses = monthExpenses.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paidBills = monthExpenses.filter((row) => row.kind === 'expense' && row.bill_key)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const bills = snapshot.recurring_bills || [];
    const occurrences = (snapshot.bill_occurrences || []).filter((row) => localDate(row.bill_month) === month)
      .map((row) => ({ ...row }));
    for (const bill of bills) {
      if (bill.status !== 'active' || localDate(bill.start_month) > month
        || occurrences.some((row) => String(row.bill_id) === String(bill.id))) continue;
      const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      const dueDay = Math.min(Number(bill.due_day), lastDay);
      occurrences.push({
        id: `pending-bill-${bill.id}-${month}`,
        bill_id: bill.id,
        bill_month: month,
        due_date: `${month.slice(0, 7)}-${String(dueDay).padStart(2, '0')}`,
        title: bill.title,
        category: bill.category,
        amount: bill.amount,
        status: 'unpaid',
        paid_at: null,
        expense_id: null,
      });
    }
    const reserved = occurrences.filter((row) => row.status === 'unpaid')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const allowanceRows = (snapshot.monthly_allowances || [])
      .filter((row) => localDate(row.allowance_month) <= month)
      .sort((a, b) => localDate(b.allowance_month).localeCompare(localDate(a.allowance_month)));
    const allowance = allowanceRows[0] || null;
    const savings = accountRecordsForRange(snapshot.savings_fund_entries || [], month, date, 'entry_date');
    const contributions = savings.filter((row) => row.kind === 'save').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const withdrawals = savings.filter((row) => row.kind === 'withdraw').reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const breakdownMap = new Map();
    monthExpenses.filter((row) => row.kind === 'expense').forEach((row) => {
      const category = row.category || 'Other';
      breakdownMap.set(category, (breakdownMap.get(category) || 0) + Number(row.amount || 0));
    });
    const breakdown = [...breakdownMap.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
    const variableExpenses = Math.max(0, expenses - paidBills);
    const monthDays = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
    const projectedMonthEnd = paidBills + (variableExpenses / Math.max(1, Number(date.slice(8, 10)))) * monthDays + reserved;
    const availableFunds = allowance == null ? null : Number(allowance.amount) + income;
    const netSavings = contributions - withdrawals;
    return {
      allowance,
      bills,
      occurrences: occurrences.sort((a, b) => localDate(a.due_date).localeCompare(localDate(b.due_date)) || Number(a.id) - Number(b.id)),
      income,
      expenses,
      paidBills,
      variableExpenses,
      savingsContributions: contributions,
      savingsWithdrawals: withdrawals,
      netSavings,
      projectedMonthEnd: Math.round(projectedMonthEnd * 100) / 100,
      projectedRemaining: availableFunds == null ? null : Math.round((availableFunds - projectedMonthEnd - netSavings) * 100) / 100,
      balance: availableFunds == null ? null : Math.round((availableFunds - expenses - reserved - netSavings) * 100) / 100,
      breakdown,
      reserved,
      through: date,
    };
  }

  async function applyQueuedToSnapshot(snapshot) {
    const data = { ...snapshot };
    const listNames = ['tasks', 'expenses', 'workouts', 'diet', 'schedule', 'goals', 'recurring_tasks',
      'templates', 'savings_funds', 'savings_fund_entries', 'recurring_bills', 'recovery', 'reflections',
      'budgets', 'monthly_allowances', 'weekly_plans', 'weekly_focus_checkins'];
    for (const name of listNames) data[name] = (snapshot[name] || []).map((row) => ({ ...row }));

    for (const entry of await allMyQueueEntries()) {
      const [pathname] = entry.path.split('?');
      const body = entry.body || {};
      const pending = { id: pendingId(entry.key), ...body, _pending: true };

      if (pathname === '/preferences/scoring' && entry.method === 'PUT') {
        data.scoring_preferences = [{ ...(data.scoring_preferences[0] || {}), ...body }];
        continue;
      }
      if (pathname === '/recovery' && entry.method === 'PUT') {
        const index = data.recovery.findIndex((row) => localDate(row.entry_date) === localDate(body.entry_date));
        const hasValue = ['sleep_hours', 'sleep_quality', 'energy', 'stress']
          .some((key) => body[key] !== undefined && body[key] !== null && body[key] !== '')
          || Boolean(String(body.note || '').trim());
        if (!hasValue) {
          if (index >= 0) data.recovery.splice(index, 1);
        } else {
          const record = { ...(index >= 0 ? data.recovery[index] : {}), ...pending, entry_date: body.entry_date };
          if (index >= 0) data.recovery[index] = record;
          else data.recovery.push(record);
        }
        continue;
      }
      if (pathname === '/reflections' && entry.method === 'POST') {
        const index = data.reflections.findIndex((row) => localDate(row.entry_date) === localDate(body.entry_date));
        const record = { ...(index >= 0 ? data.reflections[index] : {}), ...pending, mood: body.mood || 'steady' };
        if (index >= 0) data.reflections[index] = record;
        else data.reflections.push(record);
        continue;
      }
      if (pathname === '/money/budget' && entry.method === 'PUT') {
        const index = data.budgets.findIndex((row) => localDate(row.budget_date) === localDate(body.budget_date));
        if (index >= 0) data.budgets[index] = { ...data.budgets[index], ...pending };
        else data.budgets.push({ ...pending, budget_date: body.budget_date });
        continue;
      }
      if (pathname === '/money/allowance' && entry.method === 'PUT') {
        const index = data.monthly_allowances.findIndex((row) => localDate(row.allowance_month) === localDate(body.allowance_month));
        if (index >= 0) data.monthly_allowances[index] = { ...data.monthly_allowances[index], ...pending };
        else data.monthly_allowances.push({ ...pending, allowance_month: body.allowance_month });
        continue;
      }
      if (pathname === '/dashboard/week/focus' && entry.method === 'PUT') {
        const index = data.weekly_plans.findIndex((row) => localDate(row.week_start) === localDate(body.week_start));
        if (index >= 0) data.weekly_plans[index] = { ...data.weekly_plans[index], ...pending };
        else data.weekly_plans.push({ ...pending, week_start: body.week_start });
        continue;
      }
      if (pathname === '/dashboard/week/checkin' && entry.method === 'PUT') {
        const index = data.weekly_focus_checkins.findIndex((row) => localDate(row.check_date) === localDate(body.date));
        if (body.checked && index < 0) data.weekly_focus_checkins.push({ check_date: body.date });
        if (!body.checked && index >= 0) data.weekly_focus_checkins.splice(index, 1);
        continue;
      }

      const savingsEntry = pathname.match(/^\/savings\/([^/]+)\/entries$/);
      if (savingsEntry && entry.method === 'POST') {
        data.savings_fund_entries.push({
          ...pending,
          fund_id: decodeURIComponent(savingsEntry[1]),
          entry_date: body.entry_date || DateUtil.today(),
        });
        continue;
      }
      const billPath = pathname.match(/^\/money\/bills(?:\/([^/]+))?$/);
      if (billPath && entry.method === 'POST' && !billPath[1]) {
        data.recurring_bills.push({
          ...pending,
          start_month: body.start_month || `${DateUtil.today().slice(0, 7)}-01`,
          category: body.category || 'Bills',
          status: body.status || 'active',
        });
        continue;
      }
      if (billPath && billPath[1] && entry.method === 'PATCH') {
        const id = decodeURIComponent(billPath[1]);
        data.recurring_bills = data.recurring_bills.map((bill) =>
          String(bill.id) === id ? { ...bill, ...body, _pending: true } : bill);
        continue;
      }

      const collection = pathname.match(/^\/(tasks|workouts|diet|schedule|goals|recurring|templates|savings|money)(?:\/([^/]+))?$/);
      if (!collection) continue;
      const resource = collection[1];
      const id = collection[2] ? decodeURIComponent(collection[2]) : null;
      const listName = {
        tasks: 'tasks', workouts: 'workouts', diet: 'diet', schedule: 'schedule', goals: 'goals',
        recurring: 'recurring_tasks', templates: 'templates', savings: 'savings_funds', money: 'expenses',
      }[resource];
      const list = data[listName];
      if (!id && entry.method === 'POST') {
        const defaults = {
          tasks: { done: false, points: 10 },
          workouts: { done: false, exercises: [], duration_minutes: 0 },
          diet: { eaten: false, meal_label: 'Meal', points: 10 },
          schedule: { status: 'pending', points: 10 },
          goals: { target: 1, progress: 0, unit: 'times', completed: false },
          money: { kind: 'expense', category: 'Other' },
          savings: { status: 'active', saved_amount: 0 },
        }[resource] || {};
        list.push({ ...defaults, ...pending });
      } else if (id && entry.method === 'PATCH') {
        data[listName] = list.map((item) => String(item.id) === id ? { ...item, ...body, _pending: true } : item);
      } else if (id && entry.method === 'DELETE') {
        data[listName] = list.filter((item) => String(item.id) !== id);
      }
    }
    return data;
  }

  function localDailySummary(snapshot, date) {
    const tasks = (snapshot.tasks || []).filter((row) => localDate(row.task_date) === date);
    const workouts = (snapshot.workouts || []).filter((row) => localDate(row.workout_date) === date);
    const diet = (snapshot.diet || []).filter((row) => localDate(row.entry_date) === date);
    const schedule = (snapshot.schedule || []).filter((row) => localDate(row.item_date) === date);
    const expenses = (snapshot.expenses || []).filter((row) => localDate(row.expense_date) === date);
    const budget = (snapshot.budgets || []).find((row) => localDate(row.budget_date) === date) || null;
    const totalSpent = expenses.filter((row) => row.kind === 'expense')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const weights = (snapshot.scoring_preferences || [])[0] || {};
    const scoreTasks = (rows) => ({
      earned: rows.reduce((sum, row) => sum + (row.done ? Number(row.points) : 0), 0),
      possible: rows.reduce((sum, row) => sum + Number(row.points), 0),
    });
    const scoreRows = (rows, completed) => ({
      earned: rows.reduce((sum, row) => sum + completed(row), 0),
      possible: rows.reduce((sum, row) => sum + Number(row.points), 0),
    });
    const am = scoreTasks(tasks.filter((row) => row.period === 'AM'));
    const pm = scoreTasks(tasks.filter((row) => row.period === 'PM'));
    const workout = scoreRows(workouts, (row) => row.done ? Number(row.points) : 0);
    const dietScore = scoreRows(diet, (row) => row.eaten ? Number(row.points) : 0);
    const scheduleScore = scoreRows(schedule, (row) => row.status === 'done'
      ? Number(row.points)
      : row.status === 'overtime' ? Math.round(Number(row.points) * 0.5) : 0);
    const money = budget
      ? { earned: totalSpent <= Number(budget.daily_limit) ? 15 : 0, possible: 15 }
      : { earned: 0, possible: 0 };
    const weighted = [
      { ...am, weight: Number(weights.tasks ?? 1) },
      { ...pm, weight: Number(weights.tasks ?? 1) },
      { ...workout, weight: Number(weights.workouts ?? 1) },
      { ...dietScore, weight: Number(weights.diet ?? 1) },
      { ...scheduleScore, weight: Number(weights.schedule ?? 1) },
      { ...money, weight: Number(weights.money ?? 1) },
    ];
    const earned = weighted.reduce((sum, row) => sum + row.earned * row.weight, 0);
    const possible = weighted.reduce((sum, row) => sum + row.possible * row.weight, 0);
    const percentage = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;
    const rate = percentage === null ? 'No data'
      : percentage >= 90 ? 'Excellent'
        : percentage >= 75 ? 'Great'
          : percentage >= 50 ? 'Fair' : 'Room to Adjust';
    return {
      date,
      tasks,
      workouts,
      diet,
      schedule,
      expenses: expenses.sort((a, b) => Number(b.id) - Number(a.id)),
      budget,
      totalSpent,
      summary: {
        am: { ...am, percentage: am.possible ? Math.round(am.earned / am.possible * 100) : null },
        pm: { ...pm, percentage: pm.possible ? Math.round(pm.earned / pm.possible * 100) : null },
        workout,
        diet: dietScore,
        schedule: scheduleScore,
        money,
        earned,
        possible,
        percentage,
        rating: rate,
      },
    };
  }

  function localRangeSummaries(snapshot, start, end) {
    const days = [];
    for (let date = start; date <= end; date = DateUtil.addDays(date, 1)) {
      days.push({ date, ...localDailySummary(snapshot, date).summary });
    }
    return days;
  }

  function localWeekSummary(days) {
    const scored = days.filter((day) => day.percentage !== null);
    if (!scored.length) return { activeDays: 0, average: 0, bestDay: null, completionRate: 0, bestScore: 0 };
    const best = scored.reduce((current, day) => day.percentage > current.percentage ? day : current, scored[0]);
    return {
      activeDays: scored.length,
      average: Math.round(scored.reduce((sum, day) => sum + day.percentage, 0) / scored.length),
      bestDay: best.date,
      completionRate: Math.round(scored.length / Math.max(days.length, 1) * 100),
      bestScore: best.percentage,
    };
  }

  function localWeeklyRecap(days, weights) {
    const modules = [
      { key: 'tasks', label: 'tasks', earned: 0, possible: 0, weight: Number(weights.tasks ?? 1) },
      { key: 'workout', label: 'movement', earned: 0, possible: 0, weight: Number(weights.workouts ?? 1) },
      { key: 'diet', label: 'meals', earned: 0, possible: 0, weight: Number(weights.diet ?? 1) },
      { key: 'schedule', label: 'your agenda', earned: 0, possible: 0, weight: Number(weights.schedule ?? 1) },
      { key: 'money', label: 'your budget', earned: 0, possible: 0, weight: Number(weights.money ?? 1) },
    ];
    for (const day of days.filter((row) => row.percentage !== null)) {
      modules[0].earned += day.am.earned + day.pm.earned;
      modules[0].possible += day.am.possible + day.pm.possible;
      for (const module of modules.slice(1)) {
        module.earned += day[module.key].earned;
        module.possible += day[module.key].possible;
      }
    }
    const scored = modules.filter((row) => row.possible > 0 && row.weight > 0)
      .map((row) => ({ ...row, percentage: Math.round(row.earned / row.possible * 100) }));
    if (!scored.length) {
      return {
        win: 'A fresh week is a chance to start wherever you are.',
        nextStep: 'Choose one small, realistic thing to plan when you’re ready.',
      };
    }
    const strongest = scored.reduce((best, row) => row.percentage > best.percentage ? row : best, scored[0]);
    const growth = scored.reduce((lowest, row) => row.percentage < lowest.percentage ? row : lowest, scored[0]);
    return {
      win: strongest.percentage > 0
        ? `You followed through on ${strongest.label} especially well (${strongest.percentage}%).`
        : `You made space to plan ${strongest.label}. Planning is a useful first step.`,
      nextStep: growth.key === strongest.key
        ? 'Keep your plan at a pace that feels sustainable.'
        : `If it would help, make ${growth.label} easier next week with one small, manageable step.`,
    };
  }

  function localStreak(snapshot) {
    const today = DateUtil.today();
    const start = DateUtil.addDays(today, -120);
    const days = localRangeSummaries(snapshot, start, today);
    const byDate = new Map(days.map((day) => [day.date, day]));
    let cursor = byDate.get(today).percentage === null ? DateUtil.addDays(today, -1) : today;
    let streak = 0;
    let bestStreak = 0;
    let running = 0;
    let gaps = 0;
    let counting = true;
    for (let index = 0; index <= 120; index += 1) {
      const percentage = byDate.get(cursor)?.percentage ?? null;
      if (percentage === null) {
        gaps += 1;
        if (gaps > 2) counting = false;
      } else {
        gaps = 0;
        if (percentage >= 60) {
          running += 1;
          if (counting) streak = running;
          bestStreak = Math.max(bestStreak, running);
        } else {
          running = 0;
          counting = false;
        }
      }
      cursor = DateUtil.addDays(cursor, -1);
    }
    return {
      streak,
      bestStreak,
      excellentDays: days.filter((day) => day.rating === 'Excellent').length,
      greatOrBetterDays: days.filter((day) => day.rating === 'Excellent' || day.rating === 'Great').length,
      perfectDays: days.filter((day) => day.percentage === 100).length,
    };
  }

  function offlineDashboardWeek(snapshot, date) {
    const selected = new Date(`${date}T00:00:00`);
    const weekStart = DateUtil.addDays(date, -((selected.getDay() + 6) % 7));
    const previousWeekStart = DateUtil.addDays(weekStart, -7);
    const previousWeekEnd = DateUtil.addDays(weekStart, -1);
    const weekEnd = DateUtil.addDays(weekStart, 6);
    const today = DateUtil.today();
    const summaryEnd = date < today ? date : today;
    const daysEnd = summaryEnd < previousWeekEnd ? previousWeekEnd : summaryEnd;
    const days = localRangeSummaries(snapshot, previousWeekStart, daysEnd);
    const currentDays = days.filter((day) => day.date >= weekStart && day.date <= summaryEnd);
    const previousDays = days.filter((day) => day.date < weekStart);
    const weights = (snapshot.scoring_preferences || [])[0] || {};
    const plan = (snapshot.weekly_plans || []).find((row) => localDate(row.week_start) === weekStart) || {};
    const checkins = (snapshot.weekly_focus_checkins || []).filter((row) =>
      localDate(row.check_date) >= weekStart && localDate(row.check_date) <= summaryEnd);
    const inCurrent = (rows, field) => accountRecordsForRange(rows || [], weekStart, summaryEnd, field);
    const tasks = inCurrent(snapshot.tasks, 'task_date');
    const workouts = inCurrent(snapshot.workouts, 'workout_date');
    const diet = inCurrent(snapshot.diet, 'entry_date');
    const schedule = inCurrent(snapshot.schedule, 'item_date');
    const pendingAgenda = schedule.filter((row) => row.status === 'pending' && localDate(row.item_date) < today)
      .map(({ id, item_date, title, start_time, planned_minutes }) => ({ id, item_date, title, start_time, planned_minutes }));
    const pendingTasks = tasks.filter((row) => !row.done && localDate(row.task_date) < today)
      .map(({ id, task_date, period, title }) => ({ id, task_date, period, title }));
    const activity = {
      tasks_planned: tasks.length,
      tasks_completed: tasks.filter((row) => row.done).length,
      workouts_planned: workouts.length,
      workouts_completed: workouts.filter((row) => row.done).length,
      meals_planned: diet.length,
      meals_completed: diet.filter((row) => row.eaten).length,
      agenda_planned: schedule.length,
      agenda_completed: schedule.filter((row) => ['done', 'overtime'].includes(row.status)).length,
    };
    const weekly = localWeekSummary(currentDays);
    const previousWeekly = localWeekSummary(previousDays);
    return {
      weekStart,
      previousWeekStart,
      weekly,
      previousWeekly,
      recap: localWeeklyRecap(currentDays, weights),
      focus: plan.focus || '',
      restDays: plan.rest_days || [],
      focusCheckins: checkins.length,
      focusGoals: accountRecordsForRange(snapshot.goals || [], weekStart, weekEnd, 'goal_date'),
      reflection: (snapshot.reflections || []).find((row) => localDate(row.entry_date) === date) || null,
      activity,
      pendingAgenda,
      pendingTasks,
    };
  }

  function offlineDashboardTotals(snapshot) {
    const sumPoints = (rows, completed) => rows.reduce((sum, row) =>
      sum + (completed(row) ? Number(row.points || 0) : 0), 0);
    const xp = sumPoints(snapshot.tasks || [], (row) => row.done)
      + sumPoints(snapshot.workouts || [], (row) => row.done)
      + sumPoints(snapshot.diet || [], (row) => row.eaten)
      + (snapshot.schedule || []).reduce((sum, row) => sum + (
        row.status === 'done' ? Number(row.points || 0)
          : row.status === 'overtime' ? Math.round(Number(row.points || 0) * 0.5) : 0
      ), 0);
    const xpPerLevel = 500;
    const totals = { xp, level: Math.floor(xp / xpPerLevel) + 1, xpIntoLevel: xp % xpPerLevel, xpPerLevel };
    const streakStats = localStreak(snapshot);
    const badgeDefs = [
      { id: 'streak_3', label: '3-Day Streak', icon: '🔥', achieved: streakStats.streak >= 3 },
      { id: 'streak_7', label: 'Week Warrior', icon: '⚡', achieved: streakStats.streak >= 7 },
      { id: 'streak_14', label: 'Two-Week Grind', icon: '💪', achieved: streakStats.streak >= 14 },
      { id: 'streak_30', label: 'Iron Month', icon: '🏆', achieved: streakStats.streak >= 30 },
      { id: 'excellent_5', label: '5 Excellent Days', icon: '🌟', achieved: streakStats.excellentDays >= 5 },
      { id: 'perfect_1', label: 'Perfect Day', icon: '💯', achieved: streakStats.perfectDays >= 1 },
      { id: 'level_5', label: 'Level 5', icon: '🎮', achieved: totals.level >= 5 },
    ];
    const icons = new Map(badgeDefs.map((badge) => [badge.id, badge.icon]));
    const milestones = (snapshot.milestones || []).map((milestone) => ({
      ...milestone,
      icon: icons.get(milestone.milestone_key) || '🏅',
    }));
    return {
      ...totals,
      ...streakStats,
      badges: badgeDefs.filter((badge) => badge.achieved)
        .map(({ id, label, icon }) => ({ id, label, icon })),
      milestones,
    };
  }

  function offlineSnapshotResponse(path, snapshot) {
    const [pathname, queryString = ''] = path.split('?');
    const query = new URLSearchParams(queryString);
    const date = query.get('date') || DateUtil.today();
    const start = query.get('start');
    const end = query.get('end');

    if (pathname === '/dashboard') {
      const day = localDailySummary(snapshot, date);
      const selectedDate = new Date(`${date}T00:00:00`);
      const weekStart = DateUtil.addDays(date, -((selectedDate.getDay() + 6) % 7));
      const plan = (snapshot.weekly_plans || []).find((row) => localDate(row.week_start) === weekStart);
      const weeklyFocusChecked = (snapshot.weekly_focus_checkins || [])
        .some((row) => localDate(row.check_date) === date);
      return {
        ...day,
        weeklyFocus: plan ? plan.focus : '',
        weeklyFocusChecked,
        streak: date === DateUtil.today() ? localStreak(snapshot).streak : null,
        motivation: null,
      };
    }
    if (pathname === '/dashboard/monthly') {
      const month = query.get('month') || DateUtil.today().slice(0, 7);
      const [year, monthNumber] = month.split('-').map(Number);
      const lastDay = new Date(year, monthNumber, 0).getDate();
      const days = localRangeSummaries(snapshot, `${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`);
      return { month, days };
    }
    if (pathname === '/dashboard/strip') {
      const today = DateUtil.today();
      const selectedEnd = DateUtil.addDays(date, 6);
      const rollingStart = DateUtil.addDays(today, -6);
      const days = localRangeSummaries(snapshot, date, selectedEnd);
      const past = localRangeSummaries(snapshot, rollingStart, today);
      return {
        days: days.map((day) => ({ date: day.date, percentage: day.percentage })),
        past: past.map((day) => ({ date: day.date, percentage: day.percentage })),
        recap: localWeekSummary(past),
      };
    }
    if (pathname === '/dashboard/week') return offlineDashboardWeek(snapshot, date);
    if (pathname === '/dashboard/totals') return offlineDashboardTotals(snapshot);
    if (pathname === '/auth/me') return snapshot.account || null;
    if (pathname === '/preferences/scoring') {
      return (snapshot.scoring_preferences || [])[0] || { tasks: 1, workouts: 1, diet: 1, schedule: 1, money: 1 };
    }
    if (pathname === '/recurring') return snapshot.recurring_tasks || [];
    if (pathname === '/templates') {
      const kind = query.get('kind');
      return (snapshot.templates || []).filter((template) => !kind || template.kind === kind);
    }
    if (pathname === '/tasks') return (snapshot.tasks || []).filter((row) => localDate(row.task_date) === date);
    if (pathname === '/workouts') return (snapshot.workouts || []).filter((row) => localDate(row.workout_date) === date);
    if (pathname === '/diet') return (snapshot.diet || []).filter((row) => localDate(row.entry_date) === date);
    if (pathname === '/goals') {
      const weekStart = DateUtil.addDays(date, -6);
      return accountRecordsForRange(snapshot.goals || [], weekStart, date, 'goal_date');
    }
    if (pathname === '/schedule/upcoming') {
      const from = query.get('from') || DateUtil.today();
      return (snapshot.schedule || []).filter((row) => localDate(row.item_date) >= from && row.status === 'pending')
        .sort((a, b) => localDate(a.item_date).localeCompare(localDate(b.item_date))
          || String(a.start_time || '99:99').localeCompare(String(b.start_time || '99:99'))
          || Number(a.id) - Number(b.id))
        .map(({ id, item_date, title, location, start_time, planned_minutes }) => ({
          id, item_date, title, location, start_time, planned_minutes,
        }));
    }
    if (pathname === '/schedule') {
      const rows = start && end
        ? accountRecordsForRange(snapshot.schedule || [], start, end, 'item_date')
        : (snapshot.schedule || []).filter((row) => localDate(row.item_date) === date);
      return rows.sort((a, b) => localDate(a.item_date).localeCompare(localDate(b.item_date))
        || String(a.start_time || '99:99').localeCompare(String(b.start_time || '99:99'))
        || Number(a.id) - Number(b.id));
    }
    if (pathname === '/money') {
      const expenses = (snapshot.expenses || []).filter((row) => localDate(row.expense_date) === date)
        .sort((a, b) => Number(b.id) - Number(a.id));
      const budget = (snapshot.budgets || []).find((row) => localDate(row.budget_date) === date) || null;
      return { expenses, budget };
    }
    if (pathname === '/money/summary') return localMoneySummary(snapshot, query);
    if (pathname === '/money/cashflow') return localMoneyCashflow(snapshot, date);
    if (pathname === '/savings') {
      return (snapshot.savings_funds || []).map((fund) => {
        const entries = (snapshot.savings_fund_entries || []).filter((row) => String(row.fund_id) === String(fund.id));
        const saved = entries.filter((row) => row.kind === 'save').reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const withdrawn = entries.filter((row) => row.kind === 'withdraw').reduce((sum, row) => sum + Number(row.amount || 0), 0);
        return { ...fund, saved_amount: saved - withdrawn };
      }).sort((a, b) => {
        const order = { active: 0, paused: 1, completed: 2 };
        return order[a.status] - order[b.status] || localDate(b.created_date).localeCompare(localDate(a.created_date));
      });
    }
    if (pathname === '/reflections') {
      return (snapshot.reflections || []).find((row) => localDate(row.entry_date) === date) || null;
    }
    if (pathname === '/recovery') {
      return (snapshot.recovery || []).find((row) => localDate(row.entry_date) === date) || null;
    }
    if (pathname === '/recovery/week') {
      const from = DateUtil.addDays(date, -6);
      const rows = accountRecordsForRange(snapshot.recovery || [], from, date, 'entry_date');
      const average = (key) => {
        const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined);
        return values.length ? Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length * 10) / 10 : null;
      };
      return {
        start: from,
        end: date,
        checkins: rows.length,
        averageSleep: average('sleep_hours'),
        averageQuality: average('sleep_quality'),
        averageEnergy: average('energy'),
        averageStress: average('stress'),
        coachTip: '',
      };
    }
    return NO_OFFLINE_RESPONSE;
  }

  async function getOfflineResponse(userId, path) {
    let localCopy;
    try {
      localCopy = await readLocalCopy(userId);
    } catch (error) {
      throw new Error(`Could not reach the server or read saved data: ${error.message}`);
    }
    if (localCopy) {
      const currentCopy = await applyQueuedToSnapshot(localCopy.data);
      const data = offlineSnapshotResponse(path, currentCopy);
      if (data !== NO_OFFLINE_RESPONSE) {
        window.dispatchEvent(new CustomEvent('selfup:cached-data', { detail: { savedAt: localCopy.savedAt || null } }));
        return data;
      }
    }
    let cached;
    try {
      cached = await readCachedResponse(userId, path);
    } catch (error) {
      throw new Error(`Could not reach the server or read saved data: ${error.message}`);
    }
    if (!cached) {
      throw new Error('This data is not saved on this device yet. Open this page while connected to prepare it for offline use.');
    }
    // Tell the connectivity banner how old this saved copy is so it can say so plainly.
    window.dispatchEvent(new CustomEvent('selfup:cached-data', { detail: { savedAt: cached.savedAt || null } }));
    return applyQueuedChanges(path, cached.data);
  }

  function queueEvent() {
    window.dispatchEvent(new CustomEvent('selfup:queue-change'));
  }

  async function queueCount() {
    const user = getUser();
    if (!user || !('indexedDB' in window)) return 0;
    const entries = await withQueueStore('readonly', (store) => store.getAll());
    return entries.filter((entry) => entry.userId === String(user.id)).length;
  }

  async function queueEntries() {
    const user = getUser();
    if (!user || !('indexedDB' in window)) return [];
    const entries = await withQueueStore('readonly', (store) => store.getAll());
    return entries.filter((entry) => entry.userId === String(user.id))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(({ id, method, path, createdAt, lastError, lastStatus, lastAttempt }) => ({
        id, method, path, createdAt, lastError, lastStatus, lastAttempt,
      }));
  }

  async function removeQueueEntry(id) {
    const user = getUser();
    if (!user) throw new Error('Sign in before managing queued changes.');
    const entry = await withQueueStore('readonly', (store) => store.get(id));
    if (!entry || entry.userId !== String(user.id)) throw new Error('That queued change is no longer available.');
    await withQueueStore('readwrite', (store) => store.delete(id));
    queueEvent();
  }

  function saveQueueFailure(entry, message, status = null) {
    return withQueueStore('readwrite', (store) => store.put({
      ...entry,
      lastError: String(message).slice(0, 240),
      lastStatus: status,
      lastAttempt: Date.now(),
    })).then(queueEvent);
  }

  // Deleting by id is safe to replay (deleting something already gone is a no-op),
  // so simple one-item deletes can be queued too. Bill payments, savings and
  // anything with extra path parts or query strings still need a live server.
  const QUEUEABLE_DELETE = /^\/(tasks|workouts|diet|schedule|goals|recurring|money|templates)\/[^/?]+$/;

  function queueable(method, path) {
    if (method === 'DELETE') return QUEUEABLE_DELETE.test(path);
    return ['POST', 'PUT', 'PATCH'].includes(method)
      && QUEUEABLE_PATH.test(path)
      && !/^\/money\/bills\/\d+\/pay$/.test(path)
      && !/^\/templates\/[^/]+\/apply(?:-week)?$/.test(path)
      && path !== '/schedule/ical-import';
  }

  // ---- Show queued changes immediately (offline overlay) ----
  // Saved server copies never contain changes that are still waiting to sync, so
  // when we serve a saved copy we replay the waiting changes on top of it.
  const OVERLAY = {
    tasks: { dateField: 'task_date', defaults: { done: false, points: 10 } },
    workouts: { dateField: 'workout_date', defaults: { done: false, exercises: [] } },
    diet: { dateField: 'entry_date', defaults: { eaten: false } },
    schedule: { dateField: 'item_date', defaults: { done: false } },
    money: { dateField: 'expense_date', listKey: 'expenses', defaults: {} },
    goals: { dateField: 'goal_date', defaults: { target: 1, progress: 0, unit: 'times', completed: false } },
  };

  function pendingId(key) { return `pending-${key}`; }

  async function allMyQueueEntries() {
    const user = getUser();
    if (!user || !('indexedDB' in window)) return [];
    const entries = await withQueueStore('readonly', (store) => store.getAll());
    return entries.filter((entry) => entry.userId === String(user.id))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async function applyQueuedChanges(path, data) {
    const [pathname, queryString = ''] = path.split('?');
    const resource = pathname.slice(1);
    const config = OVERLAY[resource];
    if (!config) return data;
    const list = config.listKey ? (data && data[config.listKey]) : data;
    if (!Array.isArray(list)) return data;

    let entries;
    try { entries = await allMyQueueEntries(); } catch { return data; }
    entries = entries.filter((entry) => entry.path.split('?')[0].startsWith(`/${resource}`));
    if (!entries.length) return data;

    const query = new URLSearchParams(queryString);
    const date = query.get('date') || DateUtil.today();
    const start = query.get('start');
    const end = query.get('end');
    const from = query.get('from');
    const inRange = (value) => {
      const day = String(value || '').slice(0, 10);
      if (resource === 'schedule' && from) return day >= from;
      if (resource === 'goals') {
        const from = DateUtil.addDays(date, -6);
        return day >= from && day <= date;
      }
      if (start && end) return day >= start && day <= end;
      return day === date;
    };

    let items = list.map((item) => ({ ...item }));
    for (const entry of entries) {
      const pathname = entry.path.split('?')[0];
      if (entry.method === 'POST' && pathname === `/${resource}`) {
        if (config.noCreate || !entry.body || !inRange(entry.body[config.dateField])) continue;
        items.push({
          ...config.defaults,
          ...entry.body,
          ...(resource === 'schedule' ? { status: 'pending' } : {}),
          id: pendingId(entry.key),
          _pending: true,
        });
        continue;
      }
      const match = pathname.match(new RegExp(`^/${resource}/([^/]+)$`));
      if (!match) continue;
      const id = decodeURIComponent(match[1]);
      if (entry.method === 'DELETE') {
        items = items.filter((item) => String(item.id) !== id);
      } else if (entry.method === 'PATCH' || entry.method === 'PUT') {
        items = items.map((item) => (String(item.id) === id ? { ...item, ...entry.body } : item));
      }
    }
    if (resource === 'schedule' && from && pathname === '/schedule/upcoming') {
      return items
        .filter((item) => String(item.item_date || '').slice(0, 10) >= from && item.status === 'pending')
        .sort((a, b) => String(a.item_date).localeCompare(String(b.item_date))
          || String(a.start_time || '99:99').localeCompare(String(b.start_time || '99:99'))
          || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    }
    return config.listKey ? { ...data, [config.listKey]: items } : items;
  }

  function makeRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function enqueue(method, path, body, key) {
    const user = getUser();
    if (!user) throw new Error('Sign in before saving changes offline.');
    await withQueueStore('readwrite', (store) => store.put({
      id: key,
      key,
      userId: String(user.id),
      method,
      path,
      body,
      createdAt: Date.now(),
    }));
    queueEvent();
    requestBackgroundSync();
    if (typeof UI !== 'undefined') UI.toast('Offline: this change is saved on this device and will sync automatically when you are back online.');
    return { queued: true, idempotencyKey: key };
  }

  // Ask the browser (Chrome/Android) to wake us when connectivity returns.
  function requestBackgroundSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.sync && reg.sync.register('selfup-sync'))
      .catch(() => {});
  }

  // A change "needs attention" when the server understood it and refused it (for
  // example a validation error). Retrying it automatically would just fail again.
  function needsAttention(entry) {
    const status = entry.lastStatus;
    return status >= 400 && status < 500 && ![401, 408, 409, 429].includes(status);
  }

  // True when every waiting change needs the person's review, so automatic
  // retries should pause until they retry or remove them.
  async function queueBlocked() {
    const entries = await queueEntries();
    return entries.length > 0 && entries.every(needsAttention);
  }

  // After a queued create succeeds we learn its real server id. Later queued edits
  // or deletes of that same item were saved with a temporary "pending-<key>" id.
  // Swap in the real id (saved before the create is removed, so it survives a crash).
  async function remapPendingId(createdKey, realId, userId) {
    const token = pendingId(createdKey);
    const entries = await withQueueStore('readonly', (store) => store.getAll());
    for (const entry of entries) {
      if (entry.userId === userId && entry.path.includes(token)) {
        await withQueueStore('readwrite', (store) => store.put({
          ...entry,
          path: entry.path.split(token).join(String(realId)),
        }));
      }
    }
  }

  async function flushQueue(options = {}) {
    if (flushing) return flushing;
    if (!getToken()) return { synced: 0 };
    const user = getUser();
    if (!user) return { synced: 0 };

    flushing = (async () => {
      let synced = 0;
      let skipped = 0;
      const userId = String(user.id);
      const entries = await withQueueStore('readonly', (store) => store.getAll());
      const mine = entries.filter((entry) => entry.userId === userId)
        .sort((a, b) => a.createdAt - b.createdAt);
      const failedKeys = new Set();

      for (const original of mine) {
        // Re-read: an earlier create in this run may have rewritten this entry's path.
        const entry = await withQueueStore('readonly', (store) => store.get(original.id)) || null;
        if (!entry) continue;

        const dependsOnFailed = [...failedKeys].some((key) => entry.path.includes(pendingId(key)));
        const stillPending = entry.path.includes('pending-');
        if (dependsOnFailed || stillPending) {
          failedKeys.add(entry.key);
          const waiting = 'Waiting on an earlier change that needs attention.';
          if (entry.lastError !== waiting) await saveQueueFailure(entry, waiting, null);
          skipped += 1;
          continue;
        }
        if (needsAttention(entry) && !options.retryRejected) {
          failedKeys.add(entry.key);
          skipped += 1;
          continue;
        }

        let response;
        try {
          response = await fetch(`/api${entry.path}`, {
            method: entry.method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + getToken(),
              'Idempotency-Key': entry.key,
            },
            body: entry.body === undefined ? undefined : JSON.stringify(entry.body),
          });
        } catch {
          await saveQueueFailure(entry, 'Connection interrupted; waiting for a connection.');
          break;
        }

        if (response.status === 401) {
          clearSession();
          if (typeof UI !== 'undefined') UI.toast('Session expired — queued changes will wait until you log in again.');
          if (window.showAuth) showAuth();
          break;
        }
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const message = error.error || `Server returned HTTP ${response.status}.`;
          const wasKnown = entry.lastStatus === response.status && entry.lastError === String(message).slice(0, 240);
          await saveQueueFailure(entry, message, response.status);
          if (needsAttention({ lastStatus: response.status })) {
            // The server refused this one change. Keep it for review, but keep
            // syncing everything that does not depend on it.
            failedKeys.add(entry.key);
            skipped += 1;
            if (typeof UI !== 'undefined' && !wasKnown) UI.toast(`A change could not be saved and needs review: ${message}`);
            continue;
          }
          // Server busy or temporarily unavailable: stop here and retry later.
          break;
        }

        if (entry.method === 'POST') {
          const created = await response.json().catch(() => null);
          if (created && created.id !== undefined && created.id !== null) {
            await remapPendingId(entry.key, created.id, userId);
          }
        }
        await withQueueStore('readwrite', (store) => store.delete(entry.id));
        synced += 1;
        queueEvent();
      }
      if (synced && typeof UI !== 'undefined') {
        UI.toast(`${synced} offline ${synced === 1 ? 'change' : 'changes'} synced.`);
      }
      if (synced) markLastSync();
      if (synced) scheduleLocalCopyRefresh();
      return { synced, skipped };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const user = token ? getUser() : null;
    const fullAccountCopy = method === 'GET' && user && NEVER_CACHE.test(path);
    const cacheable = method === 'GET' && user && 'indexedDB' in window && !NEVER_CACHE.test(path);

    const key = queueable(method, path) ? makeRequestId() : null;
    if (key) headers['Idempotency-Key'] = key;

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (key && error.name === 'TypeError') return enqueue(method, path, body, key);
      if (fullAccountCopy && error.name === 'TypeError') {
        return getOfflineAccountCopy(String(user.id));
      }
      if (cacheable && error.name === 'TypeError') {
        return getOfflineResponse(String(user.id), path);
      }
      throw error;
    }

    if (res.status === 401) {
      clearSession();
      if (typeof UI !== 'undefined') UI.toast('Session expired — please log in again');
      if (window.showAuth) showAuth();
      throw new Error('Session expired.');
    }

    if (res.status === 204) {
      if (user) markLastSync();
      if (user && method !== 'GET') scheduleLocalCopyRefresh();
      return null;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (fullAccountCopy && res.status >= 500) {
        return getOfflineAccountCopy(String(user.id));
      }
      if (cacheable && res.status >= 500) return getOfflineResponse(String(user.id), path);
      throw new Error(data.error || 'Something went wrong.');
    }
    if (user) markLastSync();
    if (cacheable) {
      await cacheResponse(String(user.id), path, data);
      window.dispatchEvent(new CustomEvent('selfup:network-data'));
      return applyQueuedChanges(path, data);
    }
    if (user && method !== 'GET') scheduleLocalCopyRefresh();
    return data;
  }

  async function download(path, filename) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(`/api${path}`, { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not download this file.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return {
    getToken, setSession, getUser, clearSession, tokenExpiry, lastSyncTime, refreshLocalCopy,
    download, queueCount, queueEntries, queueBlocked, requestBackgroundSync, removeQueueEntry, flushQueue,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
})();

// ---- date helpers shared across pages ----
const DateUtil = {
  today() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
  addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
  weekStart(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return DateUtil.addDays(dateStr, -((date.getDay() + 6) % 7));
  },
  label(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = DateUtil.today();
    const tomorrow = DateUtil.addDays(today, 1);
    const yesterday = DateUtil.addDays(today, -1);
    if (dateStr === today) return 'Today';
    if (dateStr === tomorrow) return 'Tomorrow';
    if (dateStr === yesterday) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  },
  monthLabel(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  },
};

function ratingColorVar(rating) {
  switch (rating) {
    case 'Excellent': return 'var(--excellent)';
    case 'Great': return 'var(--great)';
    case 'Fair': return 'var(--fair)';
    case 'Room to Adjust': return 'var(--fair)';
    default: return 'var(--nodata)';
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
