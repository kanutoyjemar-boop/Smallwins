const AppState = {
  date: DateUtil.today(),
};

// ---------------- Auth screen wiring ----------------
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');

document.getElementById('show-signup').addEventListener('click', (e) => {
  e.preventDefault();
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
  document.querySelector('.auth-switch').classList.remove('hidden');
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
  const errEl = document.getElementById('signup-error');
  errEl.textContent = '';
  try {
    const { token, user } = await Api.post('/auth/signup', { name, email, password });
    Api.setSession(token, user);
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  Api.clearSession();
  mainScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
});

function showAuth() {
  mainScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
}

function enterApp() {
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  refreshXp();
  if (!window.location.hash || window.location.hash === '#/login') {
    window.location.hash = '#/';
  } else {
    renderRoute();
  }
}

// ---------------- XP pill ----------------
async function refreshXp() {
  try {
    const totals = await Api.get('/dashboard/totals');
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

function renderRoute() {
  const path = (window.location.hash || '#/').slice(1) || '/';
  const content = document.getElementById('content');

  document.querySelectorAll('.nav-item').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === path);
  });

  const renderer = routes[path];
  if (!renderer) {
    content.innerHTML = '<p class="empty-state">Page not found.</p>';
    return;
  }
  content.innerHTML = '<div class="loader">Loading…</div>';
  Promise.resolve(renderer(content)).catch((err) => {
    content.innerHTML = `<p class="empty-state">${escapeHtml(err.message || 'Something went wrong.')}</p>`;
  });
}

window.addEventListener('hashchange', renderRoute);

// ---------------- Boot ----------------
(function boot() {
  // Register the service worker everywhere it's supported (offline shell +
  // installability), not only where push is available.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker registration failed:', e));
  }
  if (Api.getToken()) {
    enterApp();
  } else {
    showAuth();
  }
})();
