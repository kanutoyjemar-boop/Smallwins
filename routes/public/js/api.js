const Api = (() => {
  const TOKEN_KEY = 'selfup_token';
  const USER_KEY = 'selfup_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function getUser() {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      clearSession();
      window.location.hash = '#/login';
      throw new Error('Session expired.');
    }

    if (res.status === 204) return null;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  return {
    getToken, setSession, getUser, clearSession,
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
    case 'Needs Work': return 'var(--needs-work)';
    default: return 'var(--nodata)';
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- saved routine/template management (shared by Tasks, Body, Agenda) ----
function routineManagerHtml(routines) {
  if (!routines.length) return '';
  return `
    <details class="routine-manage">
      <summary>Manage saved (${routines.length})</summary>
      ${routines.map((r) => `
        <div class="list-item">
          <div class="grow"><div class="title">${escapeHtml(r.name)}</div><div class="meta">${Array.isArray(r.items) ? r.items.length : 0} item${(r.items || []).length === 1 ? '' : 's'}</div></div>
          <button class="icon-x" type="button" data-delete-routine="${r.id}" aria-label="Delete ${escapeHtml(r.name)}">✕</button>
        </div>`).join('')}
    </details>`;
}

function wireRoutineManager(el, rerender) {
  el.querySelectorAll('[data-delete-routine]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this saved routine? Entries already created from it stay.')) return;
      await Api.del(`/templates/${btn.dataset.deleteRoutine}`);
      rerender();
    });
  });
}
