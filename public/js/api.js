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
      clearCachedResponses(String(user.id)).catch((error) => {
        console.warn('Could not clear this account\'s offline data:', error);
      });
    }
  }

  const QUEUE_DB = 'selfup-offline';
  const QUEUE_STORE = 'mutations';
  const RESPONSE_STORE = 'responses';
  const QUEUEABLE_PATH = /^\/(tasks|workouts|diet|money|schedule|goals|recurring|preferences|reflections|templates|dashboard\/week\/focus)(\/|$)/;
  // Full-account exports are never kept in the offline copy: they hold everything, and
  // would otherwise sit unencrypted in this browser even when the downloaded backup is encrypted.
  const NEVER_CACHE = /^\/export(\/|\?|$)/;
  let flushing = null;
  let offlineCacheWarningShown = false;

  function openQueue() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(QUEUE_DB, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(QUEUE_STORE)) {
          database.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(RESPONSE_STORE)) {
          database.createObjectStore(RESPONSE_STORE, { keyPath: 'id' });
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

  function responseCacheId(userId, path) {
    return `${userId}:${path}`;
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

  async function clearCachedResponses(userId) {
    const records = await withResponseStore('readonly', (store) => store.getAll());
    const mine = records.filter((record) => record.userId === userId);
    if (mine.length) {
      await withResponseStore('readwrite', (store) => {
        return mine.map((record) => store.delete(record.id))[0];
      });
    }
  }

  async function getOfflineResponse(userId, path) {
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
    const inRange = (value) => {
      const day = String(value || '').slice(0, 10);
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
      return { synced, skipped };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const user = token ? getUser() : null;
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
      return null;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (cacheable && res.status >= 500) return getOfflineResponse(String(user.id), path);
      throw new Error(data.error || 'Something went wrong.');
    }
    if (user) markLastSync();
    if (cacheable) {
      await cacheResponse(String(user.id), path, data);
      window.dispatchEvent(new CustomEvent('selfup:network-data'));
      return applyQueuedChanges(path, data);
    }
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
    getToken, setSession, getUser, clearSession, tokenExpiry, lastSyncTime,
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
