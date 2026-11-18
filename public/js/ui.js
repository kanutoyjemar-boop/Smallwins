// Shared premium UI layer: toasts, modals (replace native prompt/confirm/alert),
// celebrations (confetti + haptics), count-up numbers and the quick-add sheet.
const UI = (() => {
  const $ = (h) => { const t = document.createElement('div'); t.innerHTML = h.trim(); return t.firstChild; };
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const haptic = (p = 12) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  function toast(msg, { kind = 'info', undo, ms = 3200 } = {}) {
    let host = document.getElementById('toasts');
    if (!host) { host = $('<div id="toasts" aria-live="polite"></div>'); document.body.appendChild(host); }
    const t = $(`<div class="toast ${kind}"><span>${escapeHtml(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}</div>`);
    host.appendChild(t);
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 220); };
    if (undo) t.querySelector('button').onclick = () => { undo(); close(); };
    setTimeout(close, undo ? 5000 : ms);
  }

  function modal(inner) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const m = $(`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" tabindex="-1">${inner}</div></div>`);
      const dialog = m.querySelector('.modal');
      const title = dialog.querySelector('h3');
      if (title) {
        title.id = `dialog-title-${Date.now()}`;
        dialog.setAttribute('aria-labelledby', title.id);
      }
      document.body.appendChild(m);
      requestAnimationFrame(() => m.classList.add('open'));
      const done = (v) => {
        m.classList.remove('open');
        setTimeout(() => {
          m.remove();
          if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        }, 200);
        document.removeEventListener('keydown', esc);
        resolve(v);
      };
      const esc = (e) => {
        if (e.key === 'Escape') done(null);
        if (e.key === 'Tab') {
          const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
            .filter((element) => element.getClientRects().length);
          if (!focusable.length) { e.preventDefault(); dialog.focus(); return; }
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', esc);
      m.addEventListener('click', (e) => { if (e.target === m) done(null); });
      m._done = done;
      const input = m.querySelector('input');
      if (input) { input.focus(); input.select(); } else (dialog.querySelector('button') || dialog).focus();
      m.querySelector('[data-ok]')?.addEventListener('click', () => done(input ? input.value : true));
      m.querySelector('[data-cancel]')?.addEventListener('click', () => done(input ? null : false));
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    });
  }
  const prompt = (title, value = '') => modal(`<h3>${escapeHtml(title)}</h3><input type="text" value="${escapeHtml(value)}"><div class="modal-actions"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Save</button></div>`);
  const passwordPrompt = (title, help) => modal(`<h3>${escapeHtml(title)}</h3>${help ? `<p class="meta">${escapeHtml(help)}</p>` : ''}<label>Passphrase<input type="password" autocomplete="new-password"></label><div class="modal-actions"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-ok>Continue</button></div>`);
  const confirm = (msg) => modal(`<h3>${escapeHtml(msg)}</h3><div class="modal-actions"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-danger" data-ok>Confirm</button></div>`);
  const alert = (msg) => toast(msg);

  function routineWeekPlanner(selectId, buttonId, routines) {
    const days = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]];
    return `<details class="routine-week-planner">
      <summary>Plan this routine across the week</summary>
      <select id="${selectId}" aria-label="Choose a routine to plan this week">
        <option value="">Choose a routine…</option>
        ${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}
      </select>
      <div class="routine-week-days">${days.map(([label, day]) => `
        <label><input type="checkbox" data-plan-weekday value="${day}" ${day >= 1 && day <= 5 ? 'checked' : ''}>${label}</label>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="${buttonId}" type="button">Plan selected days</button>
      <p class="meta">Existing matching items are kept; this won’t duplicate the same routine entry.</p>
    </details>`;
  }

  function wireRoutineWeek(el, selectId, buttonId, date, refresh) {
    const button = el.querySelector(`#${buttonId}`);
    if (!button) return;
    button.addEventListener('click', async () => {
      const routineId = el.querySelector(`#${selectId}`)?.value;
      if (!routineId) {
        alert('Choose a saved routine first.');
        return;
      }
      const weekdays = Array.from(el.querySelectorAll('[data-plan-weekday]:checked'), (input) => Number(input.value));
      if (!weekdays.length) {
        alert('Choose at least one day for this routine.');
        return;
      }
      if (!await confirm('Add this routine to the selected days? Existing matching entries will be kept.')) return;
      button.disabled = true;
      button.textContent = 'Planning…';
      try {
        const result = await Api.post(`/templates/${encodeURIComponent(routineId)}/apply-week`, {
          week_start: DateUtil.weekStart(date),
          weekdays,
        });
        if (result && result.queued) {
          toast('Routine saved offline. Its items will appear after your device syncs.', { kind: 'win' });
          await refresh();
          return;
        }
        toast(result.count
          ? `Added ${result.count} routine ${result.count === 1 ? 'item' : 'items'} to your week.`
          : 'Those routine items are already planned for the selected days.',
          { kind: 'win' });
        await refresh();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
        button.textContent = 'Plan selected days';
      }
    });
  }

  function confetti(n = 70) {
    if (reduce()) return;
    const c = document.createElement('canvas');
    c.className = 'confetti'; c.width = innerWidth; c.height = innerHeight;
    document.body.appendChild(c);
    const x = c.getContext('2d'), cols = ['#e8b54d', '#4fd1ae', '#9b87f5', '#6c8cff', '#e5636f'];
    const ps = Array.from({ length: n }, () => ({ x: c.width / 2, y: c.height * 0.6, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 14 - 4, s: Math.random() * 6 + 4, r: Math.random() * 6, c: cols[(Math.random() * cols.length) | 0] }));
    let f = 0;
    (function tick() {
      x.clearRect(0, 0, c.width, c.height);
      ps.forEach((p) => { p.vy += 0.42; p.x += p.vx; p.y += p.vy; p.r += 0.2; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); x.restore(); });
      if (++f < 110) requestAnimationFrame(tick); else c.remove();
    })();
  }

  function countUp(el, to, ms = 700, from = 0) {
    if (!el || reduce() || isNaN(to)) return;
    const t0 = performance.now();
    (function step(t) { const k = Math.min(1, (t - t0) / ms); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(t0);
  }

  function celebrate(msg) { haptic([12, 40, 12]); confetti(28); if (msg) toast(msg, { kind: 'win' }); }

  // ---- Quick add sheet (floating + button) ----
  function quickAdd() {
    const previousFocus = document.activeElement;
    const date = AppState.date;
    const m = $(`<div class="modal-backdrop sheet"><div class="modal" role="dialog" aria-modal="true" aria-label="Quick add" tabindex="-1">
      <div class="seg"><button class="on" data-k="task">Task</button><button data-k="exp">Expense</button></div>
      <form id="qa-task"><input id="qa-title" placeholder="What needs doing?" maxlength="140" required>
        <div class="row"><select id="qa-period"><option value="AM">Morning</option><option value="PM">Afternoon / evening</option></select><input id="qa-pts" type="number" value="10" min="1" max="100"></div>
        <button class="btn btn-primary btn-block">Add task</button></form>
      <form id="qa-exp" class="hidden"><input id="qa-etitle" placeholder="What did you spend on?" required>
        <input id="qa-amt" type="number" step="0.01" min="0" placeholder="Amount (₱)" required>
        <button class="btn btn-primary btn-block">Log expense</button></form></div></div>`);
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('open'));
    const close = () => {
      m.classList.remove('open');
      setTimeout(() => {
        m.remove();
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
      }, 200);
      document.removeEventListener('keydown', onKeydown);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const focusable = [...m.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')]
          .filter((element) => element.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeydown);
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    m.querySelectorAll('.seg button').forEach((b) => b.onclick = () => {
      m.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      m.querySelector('#qa-task').classList.toggle('hidden', b.dataset.k !== 'task');
      m.querySelector('#qa-exp').classList.toggle('hidden', b.dataset.k !== 'exp');
      m.querySelector(b.dataset.k === 'task' ? '#qa-title' : '#qa-etitle').focus();
    });
    m.querySelector('#qa-title').focus();
    m.querySelector('#qa-task').onsubmit = async (e) => {
      e.preventDefault();
      await Api.post('/tasks', { task_date: date, period: m.querySelector('#qa-period').value, title: m.querySelector('#qa-title').value.trim(), points: Number(m.querySelector('#qa-pts').value) || 10 });
      close(); haptic(); toast('Task added'); window.renderRoute();
    };
    m.querySelector('#qa-exp').onsubmit = async (e) => {
      e.preventDefault();
      await Api.post('/money', { expense_date: date, title: m.querySelector('#qa-etitle').value.trim(), amount: Number(m.querySelector('#qa-amt').value), category: 'other', kind: 'expense' });
      close(); haptic(); toast('Expense logged'); window.renderRoute();
    };
  }

  // Celebrate automatically whenever something gets completed.
  const origPatch = Api.patch;
  Api.patch = async (path, body) => {
    const r = await origPatch(path, body);
    if (body && (body.done === true || body.eaten === true || body.status === 'done')) { celebrate('Nice — keep going'); window.refreshXp && refreshXp(); }
    return r;
  };

  // Accessibility: make div-based checkboxes keyboard-operable; swipe right on a row to complete it.
  function enhance(root) {
    // Items created offline have a temporary "pending-…" id until they sync.
    root.querySelectorAll('[data-del^="pending-"], [data-toggle^="pending-"], [data-edit^="pending-"]').forEach((el) => {
      const row = el.closest('.list-item');
      if (!row || row.dataset.pending) return;
      row.dataset.pending = '1';
      row.classList.add('is-pending');
      const badge = document.createElement('span');
      badge.className = 'pending-badge';
      badge.textContent = 'Waiting to sync';
      (row.querySelector('.title') || row).appendChild(badge);
    });
    root.querySelectorAll('.checkbox:not([data-a11y])').forEach((c) => {
      c.dataset.a11y = '1';
      if (c.tagName !== 'BUTTON') { c.setAttribute('role', 'checkbox'); c.tabIndex = 0; c.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); c.click(); } }); }
      c.setAttribute('aria-checked', String(c.classList.contains('checked')));
    });
    root.querySelectorAll('.list-item:not([data-swipe])').forEach((row) => {
      row.dataset.swipe = '1';
      let x0 = 0, y0 = 0;
      row.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
      row.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - x0, dy = Math.abs(e.changedTouches[0].clientY - y0);
        const box = row.querySelector('.checkbox:not(.checked)');
        if (dx > 90 && dy < 40 && box) { haptic(); box.click(); }
      }, { passive: true });
    });
  }
  new MutationObserver(() => enhance(document.getElementById('content') || document)).observe(document.body, { childList: true, subtree: true });

  // ---- Smooth render engine ----
  // Every page redraws through content.innerHTML. We intercept that single setter so that:
  //  * page changes cross-fade in with a stagger,
  //  * in-page refreshes keep scroll position, glide progress bars/ring from old -> new values,
  //    fade in only genuinely new rows, and slide when changing day.
  const BARS = '.bar-fill,.task-progress-bar,.mini-progress-fill,.xp-bar-fill,.availability-bar';
  function installRenderEngine() {
    const content = document.getElementById('content');
    if (!content) return;
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    content.setRaw = (h) => desc.set.call(content, h);
    Object.defineProperty(content, 'innerHTML', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(html) {
        const routeChange = this.classList.contains('is-leaving') || !this.children.length || !!this.querySelector('.skeleton');
        const y = window.scrollY;
        const oldBars = routeChange ? [] : [...this.querySelectorAll(BARS)].map((b) => b.style.width);
        const oldRing = routeChange ? null : this.querySelector('.score-ring.animated');
        const oldPct = oldRing ? Number(oldRing.dataset.pct) : null;
        const oldIds = new Set([...this.querySelectorAll('.list-item[data-id]')].map((r) => r.dataset.id));
        desc.set.call(this, html);
        // Any animated ring (Home, Money, Body) fills to its value on the next frame.
        const fillRings = () => this.querySelectorAll('.score-ring.animated').forEach((r) => requestAnimationFrame(() => requestAnimationFrame(() => r.style.setProperty('--p', Math.min(100, Number(r.dataset.pct) || 0)))));
        if (routeChange) {
          fillRings();
          this.classList.remove('is-leaving'); this.classList.add('route-enter');
          setTimeout(() => this.classList.remove('route-enter'), 500);
          window.scrollTo({ top: 0, behavior: 'instant' });
          return;
        }
        window.scrollTo({ top: y, behavior: 'instant' });
        fillRings();
        this.querySelectorAll(BARS).forEach((b, i) => {
          const to = b.style.width;
          if (oldBars[i] != null && oldBars[i] !== to) { b.style.width = oldBars[i]; b.getBoundingClientRect(); b.style.width = to; }
        });
        const ring = this.querySelector('.score-ring.animated');
        if (ring && oldPct != null && !isNaN(oldPct)) { ring.style.setProperty('--p', oldPct); ring.dataset.from = oldPct; }
        this.querySelectorAll('.list-item[data-id]').forEach((r) => { if (!oldIds.has(r.dataset.id)) r.classList.add('item-new'); });
        if (window.__slide) {
          const cls = window.__slide > 0 ? 'slide-next' : 'slide-prev'; window.__slide = 0;
          this.classList.add(cls); setTimeout(() => this.classList.remove(cls), 360);
        }
      },
    });
  }

  // Sliding pill behind the active nav tab.
  function movePill() {
    const nav = document.querySelector('.bottom-nav'); if (!nav) return;
    let pill = nav.querySelector('.nav-pill');
    if (!pill) { pill = document.createElement('span'); pill.className = 'nav-pill'; nav.prepend(pill); }
    const a = nav.querySelector('.nav-item.active');
    pill.style.opacity = a ? 1 : 0;
    if (a) { pill.style.width = a.offsetWidth + 'px'; pill.style.transform = `translateX(${a.offsetLeft}px)`; }
  }
  window.addEventListener('resize', movePill);

  // Instant feedback: tick the box before the server answers, remember swipe direction, tiny haptics.
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]'); if (nav) window.__slide = Number(nav.dataset.nav);
    const box = e.target.closest('.checkbox[data-toggle][data-done]');
    if (box) {
      const on = box.dataset.done !== 'true';
      box.classList.toggle('checked', on); box.classList.toggle('tick', on); box.closest('.list-item')?.classList.toggle('done', on);
      box.setAttribute('aria-checked', String(on));
      box.innerHTML = on ? '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
    }
    if (e.target.closest('.nav-item,.btn,.checkbox,.fab')) haptic(8);
  }, true);

  // Soft cross-fade when the theme is switched.
  new MutationObserver(() => { document.documentElement.classList.add('theme-anim'); setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  installRenderEngine();

  function queueReview(entries) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const rows = entries.map((entry) => `
        <li class="queue-review-item">
          <strong>${escapeHtml(entry.method)} ${escapeHtml(entry.path)}</strong>
          <span>${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Saved on this device'}</span>
          <span>${escapeHtml(entry.lastError || 'Waiting to sync when a connection is available.')}${entry.lastStatus ? ` (HTTP ${entry.lastStatus})` : ''}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-queue="${escapeHtml(entry.id)}">Remove this change</button>
        </li>`).join('');
      const m = $(`<div class="modal-backdrop"><div class="modal queue-review-modal" role="dialog" aria-modal="true" aria-labelledby="queue-review-title" tabindex="-1">
        <h3 id="queue-review-title">Queued changes (${entries.length})</h3>
        <p class="meta">Changes stay on this device until the server accepts them. A failed change remains here for review and retry.</p>
        <ul class="queue-review-list">${rows}</ul>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close-queue>Close</button><button type="button" class="btn btn-primary" data-retry-queue ${navigator.onLine ? '' : 'disabled'}>Retry sync</button></div>
      </div></div>`);
      document.body.appendChild(m);
      requestAnimationFrame(() => {
        m.classList.add('open');
        m.querySelector('[data-close-queue]').focus();
      });
      const finish = (action) => {
        m.classList.remove('open');
        setTimeout(() => {
          m.remove();
          if (previousFocus && previousFocus.isConnected) previousFocus.focus();
        }, 200);
        document.removeEventListener('keydown', onKeydown);
        resolve(action);
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') finish('close');
        if (event.key === 'Tab') {
          const focusable = [...m.querySelectorAll('button:not(:disabled)')];
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', onKeydown);
      m.querySelector('[data-close-queue]').addEventListener('click', () => finish('close'));
      m.querySelector('[data-retry-queue]').addEventListener('click', () => finish({ type: 'retry' }));
      m.querySelectorAll('[data-remove-queue]').forEach((button) => {
        button.addEventListener('click', () => finish({ type: 'remove', id: button.dataset.removeQueue }));
      });
      m.addEventListener('click', (event) => { if (event.target === m) finish('close'); });
    });
  }

  return { movePill, toast, prompt, passwordPrompt, confirm, alert, confetti, countUp, celebrate, haptic, quickAdd, routineWeekPlanner, wireRoutineWeek, queueReview };
})();
window.addEventListener('offline', () => UI.toast('You’re offline — supported changes are saved on this device until they can sync.', { ms: 5000 }));
window.addEventListener('online', () => UI.toast('Back online', { kind: 'win' }));
