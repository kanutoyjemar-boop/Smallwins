const PageDashboard = (() => {
  let renderVersion = 0;
  let dateControlsVersion = 0;

  async function render(el) {
    if (!el.querySelector('.dashboard-page')) {
      el.innerHTML = `
        <div class="dashboard-page">
          <div class="dashboard-date-controls"></div>
          <div class="dashboard-date-content"></div>
        </div>
      `;
    }
    const date = AppState.date || DateUtil.today();
    const version = ++renderVersion;
    const controlsVersion = ++dateControlsVersion;
    const [data, strip, profile, upcomingEvents] = await Promise.all([
      Api.get(`/dashboard?date=${date}`),
      Api.get(`/dashboard/strip?date=${date}`).catch(() => null),
      Api.get('/auth/me').catch(() => Api.getUser() || {}),
      Api.get(`/schedule/upcoming?from=${DateUtil.today()}`),
    ]);
    if (version !== renderVersion || controlsVersion !== dateControlsVersion) return;
    data.shareExtras = {
      past: (strip && Array.isArray(strip.past)) ? strip.past : [],
      link: buildShareLink(profile && profile.username),
      avatar: profile && profile.avatar,
    };
    data.upcomingEvents = upcomingEvents;
    const controls = el.querySelector('.dashboard-date-controls');
    const content = el.querySelector('.dashboard-date-content');
    renderDateControls(controls, strip, date, el);
    content.innerHTML = template(data, date, strip, profile);
    content.classList.remove('date-content-enter');
    requestAnimationFrame(() => content.classList.add('date-content-enter'));
    const shareName = profile && profile.username
      ? `@${profile.username}`
      : (((Api.getUser() || {}).name || '').trim() || 'Small Wins member');
    wire(content, el, data, date, shareName);
    refreshXp();
  }

  function renderDateControls(controls, strip, date, el) {
    const selectedDay = strip && strip.days && strip.days.find((day) => day.date === date);
    controls.innerHTML = `${stripHtml(strip, date, selectedDay && selectedDay.percentage)}
      <div class="date-nav">
        <button data-nav="-1" type="button" aria-label="Previous day">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1" type="button" aria-label="Next day">›</button>
      </div>
      <div class="selected-day-actions" aria-label="Plan for ${DateUtil.label(date)}">
        <a class="btn btn-ghost btn-sm" href="#/tasks">+ Task</a>
        <a class="btn btn-ghost btn-sm" href="#/schedule">+ Agenda</a>
      </div>`;
    const weekStrip = controls.querySelector('.week-strip');
    if (weekStrip) requestAnimationFrame(() => weekStrip.classList.add('week-strip-enter'));
    wireDateControls(controls, el);
  }

  function wireDateControls(controls, el) {
    controls.querySelectorAll('[data-goto]').forEach((button) => {
      button.addEventListener('click', () => {
        AppState.date = button.dataset.goto;
        render(el);
      });
    });
    controls.querySelectorAll('[data-nav]').forEach((button) => {
      button.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(AppState.date || DateUtil.today(), Number(button.dataset.nav));
        refreshDateControls(el);
      });
    });
  }

  async function refreshDateControls(el) {
    const date = AppState.date || DateUtil.today();
    const version = ++dateControlsVersion;
    const strip = await Api.get(`/dashboard/strip?date=${date}`).catch(() => null);
    if (version !== dateControlsVersion || AppState.date !== date) return;
    const controls = el.querySelector('.dashboard-date-controls');
    if (controls) renderDateControls(controls, strip, date, el);
  }

  function template(data, date, strip, profile) {
    const s = data.summary;
    const pct = s.percentage;
    const color = ratingColorVar(s.rating);
    const ringStyle = pct == null
      ? `background: conic-gradient(var(--nodata) 0 100%);`
      : `--c:${color}; --p:0;`;

    const workoutsDone = data.workouts.filter((w) => w.done).length;
    const dietEaten = data.diet.filter((d) => d.eaten).length;
    const agendaDone = data.schedule.filter((s2) => s2.status === 'done' || s2.status === 'overtime').length;
    const pendingTasks = data.tasks.filter((task) => !task.done);
    const pendingAgenda = data.schedule.filter((item) => item.status === 'pending');
    const shareStats = buildShareStats(data);
    const shareName = profile.username ? `@${profile.username}` : (((Api.getUser() || {}).name || '').trim() || 'Small Wins member');

    const hr = new Date().getHours();
    const hello = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const first = ((Api.getUser() || {}).name || '').split(' ')[0];
    const onboarding = onboardingHtml(data, date);
    return `
      <div class="greeting"><h2>${hello}${first ? ', ' + escapeHtml(first) : ''}</h2><p>${pct === 100 ? 'Perfect day. Take a bow.' : pct == null ? 'Start small. Your day does not need to be perfect.' : 'One small win is enough to keep going.'}</p></div>
      ${onboarding}
      ${focusCard(data, date)}
      ${homeNextStepHtml(data, date, onboarding)}

      ${date === DateUtil.today() && (pendingTasks.length || pendingAgenda.length) ? `
        <button class="daily-brief-trigger" id="open-daily-brief" type="button">
          <span class="daily-brief-icon" aria-hidden="true">✓</span>
          <span><strong>Today’s plan · ${pendingTasks.length + pendingAgenda.length} items left</strong><small>View your tasks and agenda</small></span>
          <span class="daily-brief-arrow" aria-hidden="true">›</span>
        </button>
        ${dailyBriefModal(pendingTasks, pendingAgenda)}
      ` : ''}
      ${pushNudgeHtml()}

      <div class="panel score-hero">
        <div class="score-ring ${pct == null ? '' : 'animated'}" data-pct="${pct ?? ''}" style="${ringStyle}">
          <div class="ring-num">
            <span class="pct">${pct == null ? '—' : pct}</span>
            <span class="pct-sym">${pct == null ? '' : '%'}</span>
          </div>
        </div>
        <div>
          <p class="rating-label" style="color:${color}">${s.rating}</p>
          <p class="rating-sub">${pct == null ? `Nothing planned yet for ${DateUtil.label(date).toLowerCase()}.` : `${s.earned} of ${s.possible} points earned`}</p>
        </div>
      </div>
      <p class="score-context">A score is information, not a judgment. Rest days with nothing planned stay unscored.</p>
      ${scoreBreakdown(s, date)}

      ${pendingTasks.length ? `<div class="panel up-next"><div class="panel-title"><h3>Up next</h3><a href="#/tasks" class="count">All tasks ›</a></div>
        ${pendingTasks.slice(0, 3).map((t) => `<div class="list-item"><button class="checkbox" data-quick="${t.id}" aria-label="Complete ${escapeHtml(t.title)}"></button><div class="grow"><div class="title">${escapeHtml(t.title)}</div></div><span class="pts-chip">+${t.points}</span></div>`).join('')}</div>` : ''}

      ${upcomingEventsHtml(data.upcomingEvents, DateUtil.today())}

      <details class="dashboard-secondary">
        <summary>More details</summary>
      ${recapHtml(strip)}
      <div class="halfday-row">
        ${halfCard('AM', s.am)}
        ${halfCard('PM', s.pm)}
      </div>

      ${localStorage.getItem('selfup_sharing_enabled') !== 'false' ? `<div class="panel share-panel">
        <div class="panel-title"><h3>Your progress, beautifully told</h3><span class="share-private-note">You choose what to share</span></div>
        <p class="rating-sub share-intro">Create a clean progress image for Stories or your feed.</p>
        <div class="share-format" role="group" aria-label="Card size">
          <button type="button" class="btn btn-sm ${getCardFormat() === 'story' ? 'btn-primary' : 'btn-ghost'}" data-card-format="story">Story 9:16</button>
          <button type="button" class="btn btn-sm ${getCardFormat() === 'feed' ? 'btn-primary' : 'btn-ghost'}" data-card-format="feed">Post 4:5</button>
        </div>
        <div class="share-preview" id="share-preview" aria-label="Preview of your progress card"></div>
        <p class="share-caption-label">CAPTION PREVIEW</p>
        <p class="share-caption" id="share-caption">${escapeHtml(buildShareMessage(data, date, shareName, data.shareExtras))}</p>
        <label class="share-link-label" for="share-public-url">Link shown on your card</label>
        <input class="share-link-input" id="share-public-url" type="url" inputmode="url" placeholder="https://your-app.example.com" value="${escapeHtml(shareLinkBase())}" />
        <p class="share-referral" id="share-referral" hidden></p>
        <div class="share-actions">
          <button class="btn btn-primary btn-sm" id="share-achievement" type="button">Share card…</button>
          <button class="btn btn-ghost btn-sm" id="copy-share-caption" type="button">Copy caption</button>
          <button class="btn btn-ghost btn-sm" data-share="facebook" type="button">Facebook</button>
          <button class="btn btn-ghost btn-sm" data-share="instagram" type="button">Instagram</button>
          <button class="btn btn-ghost btn-sm" id="download-achievement" type="button">Save image</button>
          <button class="btn btn-ghost btn-sm" id="download-achievement-pdf" type="button">Save as PDF</button>
        </div>
        <p class="share-platform-note">Only your chosen username, profile picture, score, counts, streak, and 7-day bars are included.</p>
      </div>` : ''}

      <div class="section-label">${DateUtil.label(date)} at a glance</div>
      <div class="stat-grid">
        <a class="stat-card" href="#/money" style="--accent:var(--money)">
          <div class="sc-label">Money spent</div>
          <div class="sc-value">₱${data.totalSpent.toFixed(0)}${data.budget ? ` / ₱${Number(data.budget.daily_limit).toFixed(0)}` : ''}</div>
        </a>
        <a class="stat-card" href="#/body" style="--accent:var(--body)">
          <div class="sc-label">Workouts</div>
          <div class="sc-value">${workoutsDone}/${data.workouts.length} done</div>
        </a>
        <a class="stat-card" href="#/body" style="--accent:var(--body)">
          <div class="sc-label">Diet</div>
          <div class="sc-value">${dietEaten}/${data.diet.length} meals</div>
        </a>
        <a class="stat-card" href="#/schedule" style="--accent:var(--agenda)">
          <div class="sc-label">Agenda</div>
          <div class="sc-value">${agendaDone}/${data.schedule.length} items</div>
        </a>
      </div>
      </details>
    `;
  }

  function focusCard(data, date) {
    if (!data.weeklyFocus) return '';
    const future = date > DateUtil.today();
    return `<div class="panel dashboard-focus-card">
      <div class="panel-title"><h3>This week’s focus</h3><a href="#/goals" class="count">Review week ›</a></div>
      <p class="dashboard-focus-text">${escapeHtml(data.weeklyFocus)}</p>
      <button class="btn ${data.weeklyFocusChecked ? 'btn-ghost' : 'btn-primary'} btn-sm" id="focus-checkin" type="button" aria-pressed="${data.weeklyFocusChecked}" ${future ? 'disabled' : ''}>
        ${future ? 'Check in when this day arrives' : data.weeklyFocusChecked ? `Progress noted${date === DateUtil.today() ? ' today' : ''} ✓` : `I made progress on ${date === DateUtil.today() ? 'this today' : 'this day'}`}
      </button>
    </div>`;
  }

  const STARTERS = {
    'Tiny start': [['AM','Choose one priority',10],['PM','Prepare one thing for tomorrow',10]],
    Balanced: [['AM','Make the bed',5],['AM','Drink water',5],['AM','Plan the day',10],['PM','Exercise',15],['PM','Review the day',10]],
    Student: [['AM','Review notes',15],['AM','Deep study block',20],['PM','Finish homework',20],['PM','Prep for tomorrow',10]],
    Fitness: [['AM','Stretch',10],['AM','Workout',25],['PM','Prep a healthy meal',15],['PM','Evening walk',10]],
  };

  function onboardingHtml(data, date) {
    const empty = !data.tasks.length && !data.workouts.length && !data.diet.length && !data.schedule.length;
    const userId = (Api.getUser() || {}).id;
    if (!empty || date !== DateUtil.today() || localStorage.getItem(`selfup_onboarded_${userId}`)) return '';
    return `<div class="panel onboarding"><div class="panel-title"><h3>Welcome — start small</h3></div>
      <p class="rating-sub" style="margin:0 0 12px">Preview a starter task plan, then edit or skip any item. These add tasks only.</p>
      <div class="starter-row">${Object.keys(STARTERS).map((k) => `<button class="btn btn-ghost" data-starter="${k}" type="button" aria-pressed="false">${k}</button>`).join('')}</div>
      <div id="starter-preview" class="starter-preview" aria-live="polite" hidden></div>
      <label class="onboarding-focus">Optional weekly focus
        <input type="text" maxlength="140" id="onboarding-focus" placeholder="For example: make time for movement">
      </label>
      <div class="onboarding-sample">
        <button class="btn btn-ghost btn-sm" data-sample-onboarding type="button" ${navigator.onLine ? '' : 'disabled'}>Or explore with sample entries</button>
        <p class="meta">Sample entries affect your totals and can be removed in Settings.</p>
        <p class="form-error" id="onboarding-sample-error" aria-live="polite"></p>
      </div>
      <button class="link-btn" data-skip-onboarding type="button">I’ll set up my own</button></div>`;
  }

  function homeNextStepHtml(data, date, onboarding) {
    const today = DateUtil.today();
    const empty = !data.tasks.length && !data.workouts.length && !data.diet.length && !data.schedule.length;
    if (date !== today || !empty || onboarding) return '';
    return `<section class="panel home-next-step" aria-labelledby="home-next-step-title">
      <h3 id="home-next-step-title">Not sure where to start?</h3>
      <p>One small task is plenty. You can build the rest of your day later.</p>
      <a class="btn btn-primary btn-sm" href="#/tasks">Add one task</a>
    </section>`;
  }

  function renderStarterPreview(el, key) {
    const items = STARTERS[key];
    const preview = el.querySelector('#starter-preview');
    if (!items || !preview) return;
    preview.hidden = false;
    preview.innerHTML = `
      <p class="meta">Adjust the names or untick anything you don’t want.</p>
      <div class="starter-preview-items">${items.map(([period, title], index) => `
        <label class="starter-preview-item">
          <input type="checkbox" data-starter-include="${index}" checked>
          <span>${period === 'AM' ? 'Morning' : 'Evening'}</span>
          <input type="text" data-starter-title="${index}" value="${escapeHtml(title)}" maxlength="140" aria-label="Edit ${escapeHtml(title)}">
        </label>`).join('')}</div>
      <button class="btn btn-primary btn-sm" data-starter-use type="button">Add selected tasks</button>
    `;
    el.querySelectorAll('[data-starter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.starter === key));
    });
  }

  function stripHtml(strip, date, todayPct) {
    if (!strip || !strip.days) return '';
    const color = (p) => p == null ? 'var(--nodata)' : p >= 85 ? 'var(--excellent)' : p >= 65 ? 'var(--great)' : 'var(--fair)';
    const today = DateUtil.today();
    const risk = date === today && todayPct == null && new Date().getHours() >= 18;
    return `<div class="panel week-strip"><div class="ws-days">${strip.days.map((d) => {
      const dt = new Date(d.date + 'T00:00:00');
      return `<button type="button" class="ws-day ${d.date === date ? 'sel' : ''}" data-goto="${d.date}" aria-label="${DateUtil.label(d.date)}: ${d.percentage == null ? 'no data' : d.percentage + '%'}">
        <span>${dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</span><i style="background:${color(d.percentage)}">${d.percentage == null ? '' : ''}</i><small>${d.percentage == null ? '–' : d.percentage}</small></button>`;
    }).join('')}</div>${risk ? '<p class="ws-risk">If it would help, take one small step before the day ends.</p>' : ''}</div>`;
  }

  function recapHtml(strip) {
    const r = strip && strip.recap;
    if (!r || !r.activeDays) return '';
    const best = r.bestDay ? new Date(r.bestDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' }) : '—';
    const tip = r.average >= 85
      ? 'You built a strong rhythm this week. Keep what feels sustainable.'
      : r.average >= 65
        ? 'You kept showing up. One small adjustment may make next week feel easier.'
        : 'A score is information, not a judgment. Choose one manageable step when you’re ready.';
    return `<div class="panel recap"><div class="panel-title"><h3>Your last 7 days</h3><span class="count">${r.activeDays}/7 days with scores</span></div>
      <div class="recap-grid"><div><strong>${r.average}%</strong><span>Average</span></div><div><strong>${best}</strong><span>Best day (${r.bestScore}%)</span></div></div>
      <p class="rating-sub" style="margin:10px 0 0">${tip}</p></div>`;
  }

  function upcomingEventsHtml(events, today) {
    const items = Array.isArray(events) ? events : [];
    if (!items.length) return '';
    return `
      <section class="panel upcoming-agenda" aria-labelledby="upcoming-agenda-title">
        <div class="panel-title">
          <div>
            <h3 id="upcoming-agenda-title">Upcoming agenda</h3>
            <p class="meta">${items.length ? 'Closest events first. Select an event to open its date.' : 'Add an agenda item for a future day so it shows up here.'}</p>
          </div>
          <a class="btn btn-ghost btn-sm" href="#/schedule" aria-label="Plan an event">Plan</a>
        </div>
        ${items.length ? `
          <div class="upcoming-agenda-list" aria-label="${items.length} upcoming ${items.length === 1 ? 'event' : 'events'}">
            ${items.map((item, index) => {
              const date = String(item.item_date).slice(0, 10);
              const dayLabel = date === today ? 'Today' : date === DateUtil.addDays(today, 1) ? 'Tomorrow' : DateUtil.label(date);
              const timeLabel = item.start_time ? formatBriefTime(item.start_time) : 'Any time';
              return `<a class="upcoming-event ${index === 0 ? 'upcoming-event-next' : ''}" href="#/schedule" data-upcoming-date="${escapeHtml(date)}">
                <span class="upcoming-event-date">${index === 0 ? '<strong>NEXT</strong>' : ''}<span>${escapeHtml(dayLabel)}</span><small>${escapeHtml(timeLabel)}</small></span>
                <span class="upcoming-event-detail"><strong>${escapeHtml(item.title)}</strong>${item.location ? `<small>${escapeHtml(item.location)}</small>` : ''}</span>
                <span class="upcoming-event-arrow" aria-hidden="true">›</span>
              </a>`;
            }).join('')}
          </div>
          <p class="upcoming-agenda-count">${items.length} upcoming ${items.length === 1 ? 'event' : 'events'}</p>
        ` : `<a class="upcoming-agenda-empty" href="#/schedule">Nothing scheduled yet <span aria-hidden="true">›</span></a>`}
      </section>
    `;
  }

  function pushNudgeHtml() {
    if (AppState.date !== DateUtil.today()) return '';
    if (sessionStorage.getItem('selfup_push_nudge_dismissed')) return '';
    if (typeof Push === 'undefined' || !Push.supported() || Push.permission() !== 'default') return '';
    return `
      <div class="panel push-nudge">
        <p>Turn on reminders and Small Wins will nudge your phone in the morning, in the evening, and if your streak's at risk.</p>
        <div class="row">
          <button class="btn btn-primary btn-sm" id="nudge-enable" type="button">Enable notifications</button>
          <button class="btn btn-ghost btn-sm" id="nudge-dismiss" type="button">Not now</button>
        </div>
      </div>
    `;
  }

  function halfCard(label, part) {
    const pct = part.percentage;
    return `
      <div class="halfday-card">
        <div class="hd-label">${label} tasks</div>
        <div class="hd-value">${pct == null ? '—' : pct + '%'}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct || 0}%; background:${label === 'AM' ? 'var(--tasks)' : 'var(--agenda)'}"></div></div>
      </div>
    `;
  }

  function scoreBreakdown(summary, date) {
    const parts = [
      ['Morning tasks', summary.am],
      ['Afternoon tasks', summary.pm],
      ['Workouts', summary.workout],
      ['Meals', summary.diet],
      ['Agenda', summary.schedule],
      ['Budget', summary.money],
    ].filter(([, part]) => part && part.possible > 0);
    if (!parts.length) return '';
    return `<details class="score-breakdown">
      <summary>What shaped ${DateUtil.label(date).toLowerCase()}’s score?</summary>
      <p class="meta">A neutral breakdown of planned and completed points before your personal area weights.</p>
      <ul>${parts.map(([label, part]) => `<li><span>${label}</span><strong>${Number(part.earned)} / ${Number(part.possible)}</strong></li>`).join('')}</ul>
    </details>`;
  }

  function wire(el, root, data, date, shareName) {
    const userId = (Api.getUser() || {}).id;
    const onboardingKey = `selfup_onboarded_${userId}`;
    el.querySelectorAll('[data-upcoming-date]').forEach((eventLink) => {
      eventLink.addEventListener('click', () => {
        AppState.date = eventLink.dataset.upcomingDate;
      });
    });
    el.querySelectorAll('[data-starter]').forEach((button) => button.addEventListener('click', () => {
      renderStarterPreview(el, button.dataset.starter);
    }));
    el.querySelector('#starter-preview')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-starter-use]');
      if (!button) return;
      const starterKey = el.querySelector('[data-starter][aria-pressed="true"]')?.dataset.starter;
      const items = STARTERS[starterKey] || [];
      const selected = items.flatMap(([period, , points], index) => {
        const include = el.querySelector(`[data-starter-include="${index}"]`);
        const title = el.querySelector(`[data-starter-title="${index}"]`)?.value.trim();
        return include?.checked && title ? [{ period, title, points }] : [];
      });
      if (!selected.length) {
        UI.alert('Keep or add at least one task to get started.');
        return;
      }
      button.disabled = true;
      button.textContent = 'Adding tasks…';
      let added = 0;
      try {
        for (const item of selected) {
          await Api.post('/tasks', { task_date: DateUtil.today(), ...item });
          added += 1;
        }
        await saveOnboardingFocus(el);
        localStorage.setItem(onboardingKey, '1');
        UI.toast('Your starting plan is ready. Adjust it any time.', { kind: 'win' });
        render(root);
      } catch (error) {
        if (added) {
          UI.toast(added === selected.length
            ? 'Tasks were added, but the optional weekly focus could not be saved.'
            : `Added ${added} task${added === 1 ? '' : 's'}; the rest could not be saved. Review today’s tasks.`);
          render(root);
        } else {
          UI.alert(error.message);
          button.disabled = false;
          button.textContent = 'Add selected tasks';
        }
      }
    });
    el.querySelector('[data-sample-onboarding]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const error = el.querySelector('#onboarding-sample-error');
      button.disabled = true;
      error.textContent = '';
      try {
        await Api.post('/sample-data', {});
        localStorage.setItem(onboardingKey, '1');
        UI.toast('Sample entries added. Remove them any time in Settings.', { kind: 'win' });
        render(root);
      } catch (err) {
        error.textContent = err.message || 'Could not add sample entries.';
        button.disabled = !navigator.onLine;
      }
    });
    el.querySelector('[data-skip-onboarding]')?.addEventListener('click', async () => {
      const button = el.querySelector('[data-skip-onboarding]');
      button.disabled = true;
      try {
        await saveOnboardingFocus(el);
        localStorage.setItem(onboardingKey, '1');
        render(root);
      } catch (error) {
        UI.alert(error.message);
        button.disabled = false;
      }
    });
    const ring = el.querySelector('.score-ring.animated');
    if (ring) {
      const target = Number(ring.dataset.pct);
      requestAnimationFrame(() => requestAnimationFrame(() => ring.style.setProperty('--p', target)));
      UI.countUp(ring.querySelector('.pct'), target, 700, Number(ring.dataset.from || 0));
      if (target === 100 && !sessionStorage.getItem('perfect_' + AppState.date)) { sessionStorage.setItem('perfect_' + AppState.date, '1'); setTimeout(() => UI.celebrate('Perfect day! 100%'), 500); }
    }

    async function saveOnboardingFocus(el) {
      const focus = el.querySelector('#onboarding-focus')?.value.trim();
      if (!focus) return;
      await Api.put('/dashboard/week/focus', {
        week_start: DateUtil.weekStart(DateUtil.today()),
        focus,
      });
    }
    el.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', async () => {
      b.classList.add('checked'); await Api.patch(`/tasks/${b.dataset.quick}`, { done: true }); render(root);
    }));
    const enableBtn = el.querySelector('#nudge-enable');
    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        enableBtn.disabled = true;
        enableBtn.textContent = 'Enabling…';
        try {
          await Push.enable();
          sessionStorage.setItem('selfup_push_nudge_dismissed', '1');
          render(root);
        } catch (e) {
          enableBtn.disabled = false;
          enableBtn.textContent = 'Enable notifications';
          UI.alert(e.message);
        }
      });
    }
    const dismissBtn = el.querySelector('#nudge-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        sessionStorage.setItem('selfup_push_nudge_dismissed', '1');
        render(root);
      });
    }

    const dailyBrief = el.querySelector('#daily-brief-modal');
    const openBrief = el.querySelector('#open-daily-brief');
    const briefKeyHandler = (event) => {
      if (!dailyBrief?.classList.contains('is-open')) return;
      if (event.key === 'Escape') {
        closeBrief();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dailyBrief.querySelectorAll('button:not(:disabled), a[href]')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const closeBrief = () => {
      if (!dailyBrief) return;
      dailyBrief.classList.remove('is-open');
      dailyBrief.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', briefKeyHandler);
      if (openBrief && openBrief.isConnected) openBrief.focus();
    };
    const showBrief = () => {
      if (!dailyBrief) return;
      dailyBrief.classList.add('is-open');
      dailyBrief.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', briefKeyHandler);
      dailyBrief.querySelector('[data-close-brief]')?.focus();
    };
    if (openBrief) openBrief.addEventListener('click', showBrief);
    if (dailyBrief) {
      dailyBrief.querySelectorAll('[data-close-brief]').forEach((button) => button.addEventListener('click', closeBrief));
      dailyBrief.addEventListener('click', (event) => { if (event.target === dailyBrief) closeBrief(); });
    }
    const preview = el.querySelector('#share-preview');
    let previewRender = 0;
    const renderPreview = async () => {
      if (!preview) return;
      const currentRender = ++previewRender;
      try {
        const canvas = await drawAchievementCard(data, date, shareName, data.shareExtras);
        if (currentRender !== previewRender || !preview.isConnected) return;
        canvas.className = 'share-preview-canvas';
        preview.replaceChildren(canvas);
      } catch (error) {
        console.error('Could not render share card preview:', error);
        if (currentRender === previewRender) preview.textContent = 'Preview unavailable on this device. You can still save the image.';
      }
    };
    renderPreview();
    el.querySelectorAll('[data-card-format]').forEach((btn) => {
      btn.addEventListener('click', () => {
        try { localStorage.setItem('selfup_card_format', btn.dataset.cardFormat); } catch (error) { /* ignore */ }
        el.querySelectorAll('[data-card-format]').forEach((other) => {
          other.classList.toggle('btn-primary', other === btn);
          other.classList.toggle('btn-ghost', other !== btn);
        });
        renderPreview();
      });
    });
    const urlInput = el.querySelector('#share-public-url');
    if (urlInput) {
      urlInput.addEventListener('change', () => {
        const value = urlInput.value.trim();
        try {
          if (/^https?:\/\/[^\s]+$/i.test(value)) localStorage.setItem('selfup_public_url', value.replace(/\/+$/, ''));
          else localStorage.removeItem('selfup_public_url');
        } catch (error) { /* ignore */ }
        data.shareExtras.link = buildShareLink(shareName);
        const caption = el.querySelector('#share-caption');
        if (caption) caption.textContent = buildShareMessage(data, date, shareName, data.shareExtras);
        renderPreview();
      });
    }
    const referralNote = el.querySelector('#share-referral');
    if (referralNote) {
      Api.get('/auth/referrals').then((result) => {
        if (!result || !result.count) return;
        referralNote.textContent = `${result.count} ${result.count === 1 ? 'person has' : 'people have'} joined from your link.`;
        referralNote.hidden = false;
      }).catch(() => {});
    }
    const shareBtn = el.querySelector('#share-achievement');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        await shareAchievement(buildShareMessage(data, date, shareName, data.shareExtras), 'native', data, date, shareName);
      });
    }

    el.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await shareAchievement(buildShareMessage(data, date, shareName, data.shareExtras), btn.dataset.share, data, date, shareName);
      });
    });

    const downloadBtn = el.querySelector('#download-achievement');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => downloadAchievementCard(data, date, shareName)
        .catch((error) => UI.alert(error.message || 'Could not save the image.')));
    }

    const pdfBtn = el.querySelector('#download-achievement-pdf');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', () => printAchievementCard(data, date, shareName)
        .catch((error) => UI.alert(error.message || 'Could not prepare the PDF.')));
    }

    const copyCaptionBtn = el.querySelector('#copy-share-caption');
    if (copyCaptionBtn) {
      copyCaptionBtn.addEventListener('click', async () => {
        await copyShareCaption(buildShareMessage(data, date, shareName, data.shareExtras));
      });
    }

    const focusCheckin = el.querySelector('#focus-checkin');
    if (focusCheckin) {
      focusCheckin.addEventListener('click', async () => {
        focusCheckin.disabled = true;
        try {
          await Api.put('/dashboard/week/checkin', {
            date: AppState.date,
            checked: focusCheckin.getAttribute('aria-pressed') !== 'true',
          });
          render(root);
        } catch (error) {
          UI.alert(error.message);
          focusCheckin.disabled = false;
        }
      });
    }
  }

  function dailyBriefModal(tasks, agenda) {
    return `
      <div class="daily-brief-backdrop" id="daily-brief-modal" role="dialog" aria-modal="true" aria-labelledby="daily-brief-title" aria-hidden="true">
        <div class="daily-brief-modal">
          <button class="daily-brief-close" type="button" data-close-brief aria-label="Close daily brief">×</button>
          <span class="eyebrow">DAILY BRIEF</span>
          <h2 id="daily-brief-title">Here’s your plan for today.</h2>
          <p class="rating-sub">Your remaining tasks and agenda items.</p>
          <div class="brief-list">
            ${tasks.slice(0, 5).map((task) => `<a href="#/tasks" class="brief-item" data-close-brief><span class="brief-dot task-dot"></span><span><strong>${escapeHtml(task.title)}</strong><small>${task.period} task</small></span><span aria-hidden="true">›</span></a>`).join('')}
            ${agenda.slice(0, 5).map((item) => `<a href="#/schedule" class="brief-item" data-close-brief><span class="brief-dot agenda-dot"></span><span><strong>${escapeHtml(item.title)}</strong><small>${item.start_time ? formatBriefTime(item.start_time) : 'Agenda item'}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</small></span><span aria-hidden="true">›</span></a>`).join('')}
          </div>
          <button class="btn btn-primary btn-block" type="button" data-close-brief>Got it</button>
        </div>
      </div>
    `;
  }

  function formatBriefTime(time) {
    const [hours, minutes] = String(time).split(':').map(Number);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }

  function buildShareStats(data) {
    const metrics = [
      { label: 'Tasks', done: data.tasks.filter((task) => task.done).length, total: data.tasks.length },
      { label: 'Workouts', done: data.workouts.filter((workout) => workout.done).length, total: data.workouts.length },
      { label: 'Meals', done: data.diet.filter((meal) => meal.eaten).length, total: data.diet.length },
      { label: 'Agenda', done: data.schedule.filter((item) => item.status === 'done' || item.status === 'overtime').length, total: data.schedule.length },
    ];
    return metrics.filter((metric) => metric.done > 0);
  }

  const THEMES = [
    { name: 'midnight', bg: ['#121824', '#202d3b', '#17232d'], accent: '#4fd1ae', glow: 'rgba(79,209,174,0.10)', glow2: 'rgba(232,181,77,0.08)' },
    { name: 'sunrise', bg: ['#2a1a2e', '#4a2740', '#2d1b2a'], accent: '#ffb86b', glow: 'rgba(255,184,107,0.12)', glow2: 'rgba(255,107,129,0.09)' },
    { name: 'ocean', bg: ['#0e1f2e', '#12425a', '#0d2a3a'], accent: '#6ee7f9', glow: 'rgba(110,231,249,0.11)', glow2: 'rgba(79,209,174,0.08)' },
    { name: 'forest', bg: ['#0f1f1a', '#1c3a2e', '#12281f'], accent: '#8be28b', glow: 'rgba(139,226,139,0.10)', glow2: 'rgba(232,215,120,0.08)' },
    { name: 'violet', bg: ['#17162b', '#2c2559', '#1b1a38'], accent: '#b9a6ff', glow: 'rgba(185,166,255,0.12)', glow2: 'rgba(110,231,249,0.08)' },
  ];

  const HOOKS = {
    strong: ['Another day, another win.', 'Quietly stacking wins.', 'This is what consistency looks like.', 'Small steps. Big days.'],
    steady: ['Showed up. That counts.', 'Progress, one small win at a time.', 'Not perfect. Still moving.', 'Built a better day, bit by bit.'],
    gentle: ['Some days are slow. I still showed up.', 'A small win is still a win.', 'Counting the little things today.'],
    fresh: ['A fresh start is still progress.', 'Make a plan. Show up. Repeat.'],
  };

  function dateSeed(date) {
    return String(date).split('').reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 100003, 7);
  }

  function pickHook(score, date) {
    const group = score == null ? HOOKS.fresh : score >= 85 ? HOOKS.strong : score >= 60 ? HOOKS.steady : HOOKS.gentle;
    return group[dateSeed(date) % group.length];
  }

  function pickTheme(date) {
    return THEMES[dateSeed(`t${date}`) % THEMES.length];
  }

  function shareLinkBase() {
    let custom = '';
    try { custom = (localStorage.getItem('selfup_public_url') || '').trim(); } catch (error) { custom = ''; }
    const base = custom || (typeof window !== 'undefined' ? window.location.origin : '');
    return base.replace(/\/+$/, '');
  }

  function buildShareLink(username) {
    const base = shareLinkBase();
    const handle = String(username || '').replace(/^@/, '').trim();
    return /^[a-z0-9_]{3,24}$/.test(handle) ? `${base}/?ref=${handle}` : base;
  }

  function displayLink(link) {
    return String(link).replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  function buildAchievementCardContent(data, date, username = 'Small Wins member', extras = {}) {
    const hasScore = data.summary.percentage != null;
    const stats = buildShareStats(data);
    const winsCount = stats.reduce((sum, metric) => sum + metric.done, 0);
    const streak = date === DateUtil.today() && data.streak >= 2 ? data.streak : null;
    const past = Array.isArray(extras.past) ? extras.past.slice(-7) : [];
    const link = extras.link || '';
    return {
      brand: 'SMALL WINS',
      mark: 'SW',
      kicker: hasScore ? 'DAILY PROGRESS' : 'YOUR NEXT WIN STARTS HERE',
      hook: pickHook(hasScore ? data.summary.percentage : null, date),
      score: hasScore ? String(data.summary.percentage) : null,
      rating: hasScore ? data.summary.rating : 'A fresh start is still progress.',
      date: DateUtil.label(date),
      username: username.trim() || 'Small Wins member',
      avatar: typeof extras.avatar === 'string' ? extras.avatar : '',
      stats,
      winsCount,
      streak,
      past: past.map((day) => ({ date: day.date, percentage: day.percentage == null ? null : Number(day.percentage) })),
      theme: pickTheme(date),
      footer: hasScore ? 'Progress, not perfection.' : 'Your journey starts with one small win.',
      invitation: 'Want to make progress too? Start with Small Wins.',
      cta: 'Build your own streak',
      link,
      linkLabel: link ? displayLink(link) : '',
      hashtag: '#SmallWins',
      developer: 'Developed by Your Trusted Guy',
    };
  }

  const CAPTION_OPENERS = [
    'A little progress adds up.',
    'Tiny steps, real momentum.',
    'Quietly getting better.',
    'Showing up, one small win at a time.',
  ];

  function buildShareMessage(data, date, username = 'Small Wins member', extras = {}) {
    const title = date === DateUtil.today() ? 'today' : DateUtil.label(date);
    const score = data.summary.percentage;
    const stats = buildShareStats(data)
      .map((metric) => `${metric.done}/${metric.total} ${metric.label.toLowerCase()}`)
      .join(' · ');
    const progress = score == null ? 'A fresh start is still progress.' : `My Small Wins score: ${score}% (${data.summary.rating}).`;
    const details = stats ? ` ${stats}.` : '';
    const streak = date === DateUtil.today() && data.streak >= 2 ? ` ${data.streak}-day streak.` : '';
    const opener = CAPTION_OPENERS[dateSeed(date) % CAPTION_OPENERS.length];
    const link = extras.link ? ` Try it: ${extras.link}` : '';
    return `${opener} ${title === 'today' ? 'Today' : title}: ${progress}${details}${streak} — ${username.trim() || 'Small Wins member'}. Want to make progress too? Start with Small Wins.${link} #SmallWins #DailyProgress`;
  }

  const CARD_FORMATS = {
    story: { width: 1080, height: 1920, label: 'Story (9:16)' },
    feed: { width: 1080, height: 1350, label: 'Post (4:5)' },
  };

  function getCardFormat() {
    try { return localStorage.getItem('selfup_card_format') === 'feed' ? 'feed' : 'story'; } catch (error) { return 'story'; }
  }

  function drawRing(ctx, cx, cy, radius, pct, accent) {
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    if (pct > 0) {
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(pct, 100)) / 100);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  async function drawAchievementCard(data, date, username, extras = {}, format = getCardFormat()) {
    const size = CARD_FORMATS[format] || CARD_FORMATS.story;
    const W = size.width;
    const H = size.height;
    const story = format !== 'feed';
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const card = buildAchievementCardContent(data, date, username, extras);
    const avatar = await loadCardAvatar(card.avatar);
    const t = card.theme;
    const score = card.score;
    const stats = card.stats;
    const top = story ? 150 : 64; // Stories get extra top margin so IG/FB overlays don't cover the brand.

    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, t.bg[0]);
    gradient.addColorStop(0.58, t.bg[1]);
    gradient.addColorStop(1, t.bg[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = t.glow;
    ctx.beginPath();
    ctx.arc(900, top + 90, 300, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = t.glow2;
    ctx.beginPath();
    ctx.arc(100, H - 160, 320, 0, Math.PI * 2);
    ctx.fill();

    // Brand row
    ctx.fillStyle = t.accent;
    fillRoundedRect(ctx, 76, top, 66, 66, 20);
    ctx.fillStyle = t.bg[0];
    ctx.font = '700 27px Arial';
    ctx.fillText(card.mark, 88, top + 43);
    ctx.fillStyle = '#f5f7fa';
    ctx.font = '700 34px Arial';
    ctx.fillText(card.brand, 166, top + 43);

    // Streak pill (top right), only when truthful
    if (card.streak) {
      const label = `${card.streak}-DAY STREAK`;
      ctx.font = '700 22px Arial';
      const w = ctx.measureText(label).width + 48;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      fillRoundedRect(ctx, W - 76 - w, top + 8, w, 50, 25);
      ctx.fillStyle = t.accent;
      ctx.fillText(label, W - 76 - w + 24, top + 41);
    }

    // Hook
    let y = top + (story ? 150 : 140);
    ctx.fillStyle = '#f5f7fa';
    ctx.font = `700 ${story ? 58 : 54}px Arial`;
    wrapText(ctx, card.hook, 80, y, 920, 66, 2);
    y += card.hook.length > 26 ? (story ? 150 : 130) : (story ? 90 : 70);

    // Ring + score
    const ringR = story ? 190 : 118;
    const cx = 80 + ringR + 14;
    const cy = y + ringR + 20;
    drawRing(ctx, cx, cy, ringR, score === null ? 0 : Number(score), t.accent);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5f7fa';
    if (score === null) {
      ctx.font = '700 58px Arial';
      ctx.fillText('START', cx, cy - 4);
      ctx.fillText('SMALL', cx, cy + 60);
    } else {
      ctx.font = `700 ${story ? 120 : 84}px Arial`;
      ctx.fillText(score, cx - 8, cy + (story ? 30 : 20));
      ctx.fillStyle = '#a4b0ba';
      ctx.font = '700 34px Arial';
      ctx.fillText('% score', cx, cy + (story ? 88 : 62));
    }
    ctx.textAlign = 'left';

    // Right of ring: rating + wins count
    const rx = cx + ringR + 60;
    ctx.fillStyle = t.accent;
    ctx.font = '700 40px Arial';
    ctx.fillText(card.rating, rx, cy - 40, W - rx - 60);
    ctx.fillStyle = '#a4b0ba';
    ctx.font = '500 26px Arial';
    ctx.fillText(card.date, rx, cy + 8, W - rx - 60);
    if (card.winsCount > 0) {
      ctx.fillStyle = '#f5f7fa';
      ctx.font = '700 54px Arial';
      ctx.fillText(String(card.winsCount), rx, cy + 84);
      const numW = ctx.measureText(String(card.winsCount)).width;
      ctx.fillStyle = '#d8e1e6';
      ctx.font = '600 26px Arial';
      ctx.fillText(card.winsCount === 1 ? 'small win' : 'small wins', rx + numW + 14, cy + 84);
    }
    y = cy + ringR + (story ? 60 : 56);

    const identitySize = 58;
    const identityX = 80;
    const identityY = y - identitySize + 12;
    ctx.save();
    ctx.beginPath();
    ctx.arc(identityX + identitySize / 2, identityY + identitySize / 2, identitySize / 2, 0, Math.PI * 2);
    ctx.clip();
    if (avatar) {
      ctx.drawImage(avatar, identityX, identityY, identitySize, identitySize);
    } else {
      ctx.fillStyle = t.accent;
      ctx.fillRect(identityX, identityY, identitySize, identitySize);
      ctx.fillStyle = t.bg[0];
      ctx.font = '700 30px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(card.username.replace(/^@/, '').slice(0, 1).toUpperCase() || '?', identityX + identitySize / 2, identityY + identitySize / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(identityX + identitySize / 2, identityY + identitySize / 2, identitySize / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d8e1e6';
    ctx.font = '600 25px Arial';
    ctx.fillText(`Completed by ${card.username}`, identityX + identitySize + 18, y, 844);
    y += 34;
    ctx.strokeStyle = 'rgba(245,247,250,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.lineTo(1000, y);
    ctx.stroke();
    y += story ? 56 : 30;

    // Metrics
    if (story) {
      ctx.fillStyle = '#f5f7fa';
      ctx.font = '700 20px Arial';
      ctx.letterSpacing = '3px';
      ctx.fillText('SMALL WINS, MADE VISIBLE', 80, y);
      ctx.letterSpacing = '0px';
      y += 30;
    }
    const gap = 18;
    const columns = stats.length === 1 ? 1 : 2;
    const cellWidth = (920 - gap * (columns - 1)) / columns;
    const cellHeight = story ? 112 : 92;
    stats.slice(0, 4).forEach((metric, index) => {
      const x = 80 + (index % columns) * (cellWidth + gap);
      const cellY = y + Math.floor(index / columns) * (cellHeight + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      fillRoundedRect(ctx, x, cellY, cellWidth, cellHeight, 20);
      ctx.fillStyle = '#a4b0ba';
      ctx.font = '600 20px Arial';
      ctx.fillText(metric.label.toUpperCase(), x + 24, cellY + (story ? 38 : 33));
      ctx.fillStyle = '#f5f7fa';
      ctx.font = '700 42px Arial';
      ctx.fillText(`${metric.done}/${metric.total}`, x + 24, cellY + (story ? 87 : 74));
    });
    const metricRows = Math.max(1, Math.ceil(Math.min(stats.length, 4) / columns));
    if (!stats.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      fillRoundedRect(ctx, 80, y, 920, 140, 20);
      ctx.fillStyle = '#d8e1e6';
      ctx.font = '600 28px Arial';
      ctx.fillText('Nothing logged for this day yet.', 108, y + 56);
      ctx.fillStyle = '#a4b0ba';
      ctx.font = '500 23px Arial';
      ctx.fillText('Make a plan. Show up. Count the small wins.', 108, y + 100);
    }
    y += (stats.length ? metricRows * (cellHeight + gap) : 158) + 14;

    // Last 7 days consistency bars (real scores only)
    const scoredPast = card.past.filter((day) => day.percentage != null).length;
    if (card.past.length && scoredPast >= 2) {
      ctx.fillStyle = '#f5f7fa';
      ctx.font = '700 20px Arial';
      ctx.letterSpacing = '3px';
      ctx.fillText('LAST 7 DAYS', 80, y + 20);
      ctx.letterSpacing = '0px';
      const barArea = story ? 130 : 70;
      const slot = 920 / 7;
      card.past.forEach((day, index) => {
        const bx = 80 + index * slot + 8;
        const bw = slot - 16;
        const base = y + 40 + barArea;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        fillRoundedRect(ctx, bx, base - barArea, bw, barArea, 10);
        if (day.percentage != null) {
          const bh = Math.max(10, (barArea * day.percentage) / 100);
          ctx.fillStyle = t.accent;
          fillRoundedRect(ctx, bx, base - bh, bw, bh, 10);
        }
        const dow = new Date(`${day.date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
        ctx.fillStyle = '#81909a';
        ctx.font = '600 18px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(dow, bx + bw / 2, base + 26);
        ctx.textAlign = 'left';
      });
      y += 40 + barArea + 50;
    }

    // CTA block pinned to the bottom (above story safe zone)
    const bottomPad = story ? 250 : 56;
    const ctaH = story ? 150 : 124;
    const ctaY = Math.max(y + 24, H - bottomPad - ctaH - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    fillRoundedRect(ctx, 80, ctaY, 920, ctaH, 28);
    ctx.fillStyle = t.accent;
    ctx.font = '700 34px Arial';
    ctx.fillText(card.cta, 112, ctaY + (story ? 56 : 50), 856);
    ctx.fillStyle = '#d8e1e6';
    ctx.font = '500 25px Arial';
    ctx.fillText(card.linkLabel ? `Start at ${card.linkLabel}` : card.invitation, 112, ctaY + (story ? 102 : 92), 856);
    ctx.fillStyle = '#81909a';
    ctx.font = '500 20px Arial';
    ctx.fillText(`${card.hashtag}  ·  ${card.developer}`, 80, H - bottomPad + 10);
    return canvas;
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    const words = String(text).split(' ');
    let line = '';
    let lines = 0;
    words.forEach((word, index) => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y + lines * lineHeight);
        lines += 1;
        line = word;
      } else {
        line = test;
      }
      if (index === words.length - 1 && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
    });
  }

  function loadCardAvatar(source) {
    if (!source) return Promise.resolve(null);
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = source;
    });
  }

  function fillRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
    ctx.fill();
  }

  async function downloadAchievementCard(data, date, username) {
    const canvas = await drawAchievementCard(data, date, username, data.shareExtras);
    const link = document.createElement('a');
    link.download = `small-wins-${date}-progress.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async function printAchievementCard(data, date, username) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) throw new Error('Allow pop-ups to print or save your progress card as a PDF.');
    try {
      const format = getCardFormat();
      const canvas = await drawAchievementCard(data, date, username, data.shareExtras, format);
      const image = canvas.toDataURL('image/png');
      const pageHeight = format === 'feed' ? 135 : 192;
      printWindow.document.open();
      printWindow.document.write(`<!doctype html>
        <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Small Wins progress — ${escapeHtml(date)}</title><style>
          @page { margin: 0; size: 108mm ${pageHeight}mm; }
          * { box-sizing: border-box; }
          body { margin: 0; background: #10131b; color: #fff; font: 16px/1.5 Arial, sans-serif; }
          main { width: 100vw; height: 100vh; display: grid; place-items: center; }
          img { display: block; width: 100%; height: 100%; object-fit: contain; }
        </style></head><body><main><img src="${image}" alt="Small Wins progress card for ${escapeHtml(username)}"></main>
        <script>window.addEventListener('load', () => setTimeout(() => window.print(), 150));</script></body></html>`);
      printWindow.document.close();
    } catch (error) {
      printWindow.close();
      throw error;
    }
  }

  async function shareAchievement(message, platform, data, date, username) {
    let imageFile;
    try {
      imageFile = dataUrlToFile(
        (await drawAchievementCard(data, date, username, data.shareExtras)).toDataURL('image/png'),
        `small-wins-${date}-progress.png`
      );
    } catch (error) {
      UI.alert('Could not prepare the share image. Please use Save image and try again.');
      return;
    }

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
      try {
        await navigator.share({ title: 'My Small Wins progress', text: message, files: [imageFile] });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    } else if (platform === 'native' && navigator.share) {
      try {
        await navigator.share({ title: 'My Small Wins progress', text: message });
        return;
      } catch (error) {
        if (error.name === 'AbortError') return;
      }
    }

    if (platform === 'facebook') {
      await downloadAchievementCard(data, date, username);
      copyShareCaption(message);
      const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      const shareUrl = `${window.location.origin}${window.location.pathname}`;
      if (!isLocal) {
        window.open(
          `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(message)}`,
          '_blank',
          'noopener,noreferrer,width=600,height=600'
        );
      } else {
        window.open('https://www.facebook.com/', '_blank', 'noopener,noreferrer');
      }
      UI.alert('Caption copied. Save the progress image, then add it to your Facebook post.');
      return;
    }
    if (platform === 'instagram') {
      await downloadAchievementCard(data, date, username);
      copyShareCaption(message);
      window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
      UI.alert('Image saved. Add it to your Instagram post, then paste the copied caption.');
      return;
    }
    copyShareCaption(message);
    await downloadAchievementCard(data, date, username);
    UI.alert('Image saved. Choose Messenger or another app from your device share menu.');
  }

  function dataUrlToFile(dataUrl, filename) {
    const [header, encoded] = dataUrl.split(',');
    const mimeType = header.match(/data:([^;]+)/)[1];
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], filename, { type: mimeType });
  }

  async function copyShareCaption(message) {
    try {
      await navigator.clipboard.writeText(message);
      UI.toast('Caption copied.');
    } catch (error) {
      UI.alert('Could not access the clipboard. Select and copy the caption shown above.');
    }
  }

  return { render, buildShareMessage, buildShareStats, buildAchievementCardContent, buildShareLink };
})();

if (typeof module !== 'undefined') module.exports = PageDashboard;
