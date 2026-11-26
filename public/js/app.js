const AppState = {
  date: DateUtil.today(),
};

// ---------------- Auth screen wiring ----------------
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');
const connectivityStatus = document.getElementById('connectivity-status');
const connectivityMessage = document.getElementById('connectivity-message');
const queueReviewButton = document.getElementById('review-queue');
const isLocalServer = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
let cachedDataInUse = false;
let cachedOldestSavedAt = null; // oldest saved copy shown since the last live response

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-password-toggle]');
  if (!button) return;
  const input = document.getElementById(button.getAttribute('aria-controls'));
  if (!input) return;
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Hide' : 'Show';
  button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} password`);
  button.setAttribute('aria-pressed', String(visible));
});

// "3 hours ago", "2 days ago" — plain wording for how old a saved copy is.
function describeAge(timestamp) {
  if (!timestamp) return null;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function updateConnectivityStatus() {
  const offline = !navigator.onLine;
  let queued = 0;
  try {
    queued = await Api.queueCount();
  } catch (error) {
    connectivityMessage.textContent = offline
      ? 'Offline. New changes cannot be saved until this device reconnects.'
      : `Could not read queued changes on this device: ${error.message}`;
    connectivityStatus.classList.remove('hidden');
    queueReviewButton.classList.add('hidden');
    return;
  }
  const expiry = Api.getToken() ? Api.tokenExpiry() : null;
  const daysLeft = expiry ? (expiry - Date.now()) / 86400000 : null;
  const expiryNote = daysLeft !== null && daysLeft < 7 && (offline || queued > 0)
    ? (daysLeft <= 0
      ? ' Your login has expired: connect to the internet and sign in again to sync.'
      : ` Your login expires in ${Math.max(1, Math.ceil(daysLeft))} day(s); sign in again while online to keep syncing.`)
    : '';
  const visible = offline || queued > 0 || cachedDataInUse;
  connectivityStatus.classList.toggle('hidden', !visible);
  const queuedMessage = queued
    ? ` ${queued} queued ${queued === 1 ? 'change is' : 'changes are'} waiting to sync.`
    : '';
  const lastSync = Api.lastSyncTime();
  const syncNote = !isLocalServer
    ? lastSync
      ? ` Last synced with your account ${new Date(lastSync).toLocaleString()}.`
      : ' This device has not synced account data yet.'
    : '';
  const savedAge = describeAge(cachedOldestSavedAt);
  const staleNote = savedAge ? ` The oldest page shown was saved ${savedAge}.` : '';
  connectivityMessage.textContent = cachedDataInUse
    ? `${offline ? 'Offline' : 'The server is unavailable'}. Showing saved data; it may be out of date.${staleNote}${queuedMessage}`
    : offline && isLocalServer
      ? `No internet connection. Local Small Wins data stays on this computer while the app and database are running.${queuedMessage}`
    : offline
    ? `Offline. Supported entries, edits, and single-item deletes are queued on this device. ${queued} ${queued === 1 ? 'change' : 'changes'} waiting. Imports and some account or money actions need a connection.`
    : `${queued} offline ${queued === 1 ? 'change is' : 'changes are'} waiting to sync.`;
  connectivityMessage.textContent += expiryNote + syncNote;
  queueReviewButton.classList.toggle('hidden', queued === 0);
}

async function reviewQueuedChanges() {
  try {
    const entries = await Api.queueEntries();
    if (!entries.length) {
      await updateConnectivityStatus();
      return;
    }
    const action = await UI.queueReview(entries);
    if (action && action.type === 'remove') {
      if (await UI.confirm('Remove this queued change from this device? It will not be sent to the server.')) {
        await Api.removeQueueEntry(action.id);
      }
      await updateConnectivityStatus();
    } else if (action && action.type === 'retry') {
      await Api.flushQueue({ retryRejected: true });
      await updateConnectivityStatus();
    }
  } catch (error) {
    UI.alert(`Could not load queued changes: ${error.message}`);
  }
}
queueReviewButton.addEventListener('click', reviewQueuedChanges);

window.addEventListener('offline', updateConnectivityStatus);
// After reconnecting, replace any saved (possibly old) page with live data. Waits until
// every queued change is accepted so the person never sees their own change disappear.
async function refreshIfStale(synced) {
  if (!window.renderRoute || !Api.getToken()) return;
  if (await Api.queueCount() !== 0) return;
  if (!synced && !cachedDataInUse) return;
  renderRoute();
  if (window.refreshXp) refreshXp();
}

window.addEventListener('online', async () => {
  await updateConnectivityStatus();
  let result = null;
  try {
    result = await Api.flushQueue();
  } catch (error) {
    UI.toast(`Could not sync offline changes: ${error.message}`);
  }
  try {
    await Api.refreshLocalCopy();
  } catch (error) {
    UI.toast(`Could not sync the device copy: ${error.message}`);
  }
  try { await refreshIfStale(result && result.synced); } catch { /* the next trigger will retry */ }
  updateConnectivityStatus();
});
window.addEventListener('selfup:queue-change', updateConnectivityStatus);

// ---- Automatic sync ----
// The browser's "online" event is unreliable (Wi-Fi can be connected with no internet),
// so also retry on app focus, on a timer while changes are waiting, and when the
// service worker's background sync fires.
let autoSyncing = false;
async function autoSync({ refreshStale = false } = {}) {
  if (autoSyncing || !Api.getToken() || !navigator.onLine) return;
  autoSyncing = true;
  try {
    if (await Api.queueCount() === 0) {
      // Nothing to send, but the page may still be showing an old saved copy.
      if (refreshStale) {
        try { await Api.refreshLocalCopy({ maxAgeMs: 300000 }); }
        catch (error) { UI.toast(`Could not sync the device copy: ${error.message}`); }
        await refreshIfStale(0);
      }
      return;
    }
    if (await Api.queueBlocked()) return;
    const result = await Api.flushQueue();
    if (refreshStale || (result && result.synced)) {
      try { await Api.refreshLocalCopy({ maxAgeMs: result && result.synced ? 0 : 300000 }); }
      catch (error) { UI.toast(`Could not sync the device copy: ${error.message}`); }
    }
    await refreshIfStale(result && result.synced);
  } catch (error) {
    // Still offline or server unreachable: try again on the next trigger.
  } finally {
    autoSyncing = false;
    updateConnectivityStatus();
  }
}
// The timer only sends waiting changes; it never redraws the page under someone who is typing.
setInterval(() => autoSync(), 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoSync({ refreshStale: true }); });
window.addEventListener('focus', () => autoSync({ refreshStale: true }));
window.addEventListener('online', () => setTimeout(() => autoSync({ refreshStale: true }), 1500));
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'flush-queue') autoSync({ refreshStale: true });
  });
}
window.addEventListener('selfup:cached-data', (event) => {
  cachedDataInUse = true;
  const savedAt = event.detail && event.detail.savedAt;
  if (savedAt && (!cachedOldestSavedAt || savedAt < cachedOldestSavedAt)) cachedOldestSavedAt = savedAt;
  updateConnectivityStatus();
});
window.addEventListener('selfup:network-data', () => {
  cachedDataInUse = false;
  cachedOldestSavedAt = null;
  updateConnectivityStatus();
});
updateConnectivityStatus();

// Say plainly where entries are kept, so nobody expects the hosted and local apps to sync.
(function showDataLocationNote() {
  const note = document.getElementById('auth-data-note');
  if (!note) return;
  note.textContent = isLocalServer
    ? 'This is the local app: your entries are stored on this computer and do not sync with a hosted account or your phone.'
    : 'This is the hosted app: your account is stored online and a complete copy is kept on this device for offline use. It syncs with your account when connected and does not sync with a local Windows app.';
})();

// A shared link like /?ref=username is remembered so the new account credits the member who shared it.
(function captureReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^[a-z0-9_]{3,24}$/i.test(ref)) localStorage.setItem('selfup_ref', ref.toLowerCase());
  } catch (error) { /* storage unavailable */ }
})();

// The sign-up form only asks for an invite code when the server requires one.
let signupConfigPromise = null;
function loadSignupConfig() {
  if (!signupConfigPromise) {
    signupConfigPromise = fetch('/api/auth/signup-config')
      .then((res) => (res.ok ? res.json() : { inviteRequired: false }))
      .catch(() => ({ inviteRequired: false }));
  }
  return signupConfigPromise;
}

document.getElementById('fab').addEventListener('click', () => UI.quickAdd());

const moreMenuButton = document.querySelector('.more-nav-toggle');
const moreMenu = document.getElementById('mobile-more-menu');

function closeMoreMenu(restoreFocus = false) {
  if (!moreMenu || !moreMenuButton || moreMenu.classList.contains('hidden')) return;
  moreMenu.classList.add('hidden');
  moreMenuButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) moreMenuButton.focus();
}

moreMenuButton.addEventListener('click', () => {
  const isOpening = moreMenu.classList.contains('hidden');
  moreMenu.classList.toggle('hidden', !isOpening);
  moreMenuButton.setAttribute('aria-expanded', String(isOpening));
  if (isOpening) moreMenu.querySelector('a')?.focus();
});

document.addEventListener('click', (event) => {
  if (!moreMenu.classList.contains('hidden')
      && !moreMenu.contains(event.target)
      && !moreMenuButton.contains(event.target)) {
    closeMoreMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !moreMenu.classList.contains('hidden')) {
    closeMoreMenu(true);
  }
});

document.getElementById('show-signup').addEventListener('click', (e) => {
  e.preventDefault();
  loadSignupConfig().then((config) => {
    if (!config.inviteRequired || document.getElementById('signup-invite')) return;
    // Created on demand: open-signup installs never show an invite field.
    const label = document.createElement('label');
    label.append('Invite code');
    const input = document.createElement('input');
    Object.assign(input, { type: 'text', id: 'signup-invite', required: true, autocomplete: 'off', spellcheck: false });
    input.setAttribute('autocapitalize', 'off');
    label.append(input);
    document.getElementById('signup-password').closest('label').after(label);
  });
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('signup-form').classList.remove('hidden');
  document.querySelector('.auth-switch').classList.add('hidden');
  document.getElementById('show-login-wrap').classList.remove('hidden');
});
document.getElementById('show-login').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('signup-form').classList.add('hidden');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('show-login-wrap').classList.add('hidden');
  document.getElementById('login-switch').classList.remove('hidden');
});
document.getElementById('show-password-reset').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-form').classList.add('hidden');
  document.getElementById('login-switch').classList.add('hidden');
  document.getElementById('password-reset-request-form').classList.remove('hidden');
  document.getElementById('reset-back-login').classList.remove('hidden');
});
document.getElementById('reset-back-login-link').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('password-reset-request-form').classList.add('hidden');
  document.getElementById('password-reset-form').classList.add('hidden');
  document.getElementById('password-reset-complete').classList.add('hidden');
  document.getElementById('reset-back-login').classList.add('hidden');
  history.replaceState(null, '', window.location.pathname);
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('login-switch').classList.remove('hidden');
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const { token, user } = await Api.post('/auth/login', { email, password });
    Api.setSession(token, user);
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const inviteField = document.getElementById('signup-invite');
  const inviteCode = inviteField ? inviteField.value.trim() : undefined;
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  try {
    let ref;
    try { ref = localStorage.getItem('selfup_ref') || undefined; } catch (error) { ref = undefined; }
    const { token, user } = await Api.post('/auth/signup', { name, email, password, inviteCode, ref });
    Api.setSession(token, user);
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('password-reset-request-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = document.getElementById('reset-request-error');
  const success = document.getElementById('reset-request-success');
  error.textContent = '';
  success.textContent = '';
  try {
    const result = await Api.post('/auth/password/forgot', {
      email: document.getElementById('reset-request-email').value.trim(),
    });
    success.textContent = result.message;
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById('password-reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = document.getElementById('password-reset-error');
  error.textContent = '';
  const password = document.getElementById('reset-new-password').value;
  if (password !== document.getElementById('reset-confirm-password').value) {
    error.textContent = 'Passwords do not match.';
    return;
  }
  try {
    await Api.post('/auth/password/reset', {
      token: document.getElementById('password-reset-token').value,
      password,
    });
    document.getElementById('password-reset-form').classList.add('hidden');
    document.getElementById('password-reset-complete').classList.remove('hidden');
    document.getElementById('reset-back-login').classList.remove('hidden');
    history.replaceState(null, '', window.location.pathname);
  } catch (err) {
    error.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await Api.clearSession();
  mainScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

function showAuth() {
  window.location.hash = '';
  mainScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
}

// Ask the browser not to evict saved offline data when phone storage runs low.
function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted()
      .then((already) => (already ? true : navigator.storage.persist()))
      .catch(() => {});
  }
}

function enterApp() {
  requestPersistentStorage();
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  renderProfileAvatar();
  const user = Api.getUser();
  if (user && !Object.hasOwn(user, 'avatar')) {
    Api.get('/auth/me').then((profile) => {
      Api.setSession(Api.getToken(), { ...Api.getUser(), ...profile });
      renderProfileAvatar(profile);
    }).catch((error) => console.warn('Could not refresh the account profile:', error));
  }
  Api.flushQueue()
    .catch((error) => UI.toast(`Could not sync offline changes: ${error.message}`))
    .then(() => Api.refreshLocalCopy())
    .catch((error) => UI.toast(`Could not sync the device copy: ${error.message}`));
  updateConnectivityStatus();
  refreshXp();
  if (!window.location.hash || window.location.hash === '#/login') {
    window.location.hash = '#/';
  } else {
    renderRoute();
  }
}

function renderProfileAvatar(user = Api.getUser()) {
  const image = document.getElementById('profile-avatar-image');
  const initials = document.getElementById('profile-avatar-initials');
  if (!image || !initials) return;
  const avatar = user && typeof user.avatar === 'string' ? user.avatar : '';
  initials.textContent = (user && (user.name || user.email) || '?').trim().slice(0, 1).toUpperCase();
  image.classList.toggle('hidden', !avatar);
  initials.classList.toggle('hidden', Boolean(avatar));
  if (avatar) {
    image.onerror = () => {
      image.classList.add('hidden');
      initials.classList.remove('hidden');
    };
    image.src = avatar;
  }
}
window.renderProfileAvatar = renderProfileAvatar;

// ---------------- XP pill ----------------
async function refreshXp() {
  try {
    const totals = await Api.get('/dashboard/totals');
    const prev = window.__lvl; window.__lvl = totals.level;
    if (prev && totals.level > prev) UI.celebrate(`Level up! You're now Lv ${totals.level}`);
    document.getElementById('xp-level').textContent = `Lv ${totals.level}`;
    const pct = Math.round((totals.xpIntoLevel / totals.xpPerLevel) * 100);
    document.getElementById('xp-bar-fill').style.width = `${pct}%`;
  } catch (e) { /* non-critical */ }
}
window.refreshXp = refreshXp;

// ---------------- Router ----------------
const routes = {
  '/': (el) => PageDashboard.render(el),
  '/tasks': (el) => PageTasks.render(el),
  '/money': (el) => PageMoney.render(el),
  '/body': (el) => PageBody.render(el),
  '/schedule': (el) => PageSchedule.render(el),
  '/stats': (el) => PageStats.render(el),
  '/goals': (el) => PageGoals.render(el),
  '/settings': (el) => PageSettings.render(el),
};

let routeToken = 0;
let renderedPath = null;
function renderRoute() {
  if (!Api.getToken()) {
    renderedPath = null;
    return showAuth();
  }
  const path = (window.location.hash || '#/').slice(1) || '/';
  const routeChanged = path !== renderedPath;
  renderedPath = path;
  const content = document.getElementById('content');

  document.querySelectorAll('.nav-item').forEach((a) => {
    const itemPath = a.dataset.route || (a.getAttribute('href') || '').replace(/^#/, '');
    a.classList.toggle('active', itemPath === path);
    if (itemPath === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  moreMenuButton.classList.toggle('active', ['/body', '/stats', '/goals', '/settings'].includes(path));
  if (!['/body', '/stats', '/goals', '/settings'].includes(path)) closeMoreMenu();
  UI.movePill();

  const renderer = routes[path];
  if (!renderer) {
    content.innerHTML = '<p class="empty-state">Page not found.</p>';
    return;
  }
  const token = ++routeToken;
  // Keep the old page on screen (dimmed) while the next one loads; show a skeleton only on first load.
  if (content.children.length) {
    if (routeChanged) content.classList.add('is-leaving');
  }
  else content.setRaw('<div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div>');
  Promise.resolve(renderer(content)).catch((err) => {
    if (token !== routeToken) return;
    content.classList.remove('is-leaving');
    content.innerHTML = `<p class="empty-state">${escapeHtml(err.message || 'Something went wrong.')}</p>`;
  }).finally(() => { if (token === routeToken) content.classList.remove('is-leaving'); });
}

window.renderRoute = renderRoute;
window.addEventListener('hashchange', () => {
  const focusContent = !moreMenu.classList.contains('hidden') && moreMenu.contains(document.activeElement);
  closeMoreMenu();
  renderRoute();
  if (focusContent) document.getElementById('content').focus();
});

// ---------------- Boot ----------------
(function boot() {
  if (typeof Push !== 'undefined') Push.registerServiceWorker();
  if (typeof Install !== 'undefined') Install.init();
  UI.movePill();
  const resetToken = new URLSearchParams(window.location.hash.slice(1)).get('reset_token');
  if (resetToken) {
    history.replaceState(null, '', window.location.pathname);
    Api.clearSession();
    showAuth();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('login-switch').classList.add('hidden');
    document.getElementById('password-reset-form').classList.remove('hidden');
    document.getElementById('password-reset-token').value = resetToken;
    document.getElementById('reset-back-login').classList.remove('hidden');
  } else if (Api.getToken()) {
    enterApp();
  } else {
    showAuth();
    // Someone arriving from a shared link goes straight to sign-up.
    if (new URLSearchParams(window.location.search).get('ref')) {
      document.getElementById('show-signup').click();
    }
  }
})();
