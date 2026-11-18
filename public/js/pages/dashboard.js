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
    const [data, strip, profile] = await Promise.all([
      Api.get(`/dashboard?date=${date}`),
      Api.get(`/dashboard/strip?date=${date}`).catch(() => null),
      Api.get('/auth/me').catch(() => Api.getUser() || {}),
    ]);
    if (version !== renderVersion || controlsVersion !== dateControlsVersion) return;
    const controls = el.querySelector('.dashboard-date-controls');
    const content = el.querySelector('.dashboard-date-content');
    renderDateControls(controls, strip, date, el);
    content.innerHTML = template(data, date, strip, profile);
    content.classList.remove('date-content-enter');
    requestAnimationFrame(() => content.classList.add('date-content-enter'));
    wire(content, el, data, date);
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
        <a class="btn btn-ghost btn-sm" href="#/tasks">Add tasks for ${DateUtil.label(date)}</a>
        <a class="btn btn-ghost btn-sm" href="#/schedule">Plan agenda for ${DateUtil.label(date)}</a>
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
    return `
      <div class="greeting"><h2>${hello}${first ? ', ' + escapeHtml(first) : ''}</h2><p>${pct === 100 ? 'Perfect day. Take a bow.' : pct == null ? 'Plan your day to start scoring.' : 'Every check-off moves the ring.'}</p></div>
      ${onboardingHtml(data, date)}
      ${focusCard(data, date)}

      ${date === DateUtil.today() && (pendingTasks.length || pendingAgenda.length) ? `
        <button class="daily-brief-trigger" id="open-daily-brief" type="button">
          <span class="daily-brief-icon">!</span>
          <span><strong>${pendingTasks.length + pendingAgenda.length} things need your attention</strong><small>Open your daily brief</small></span>
          <span class="daily-brief-arrow" aria-hidden="true">›</span>
        </button>
        ${dailyBriefModal(pendingTasks, pendingAgenda)}
      ` : ''}

      ${data.motivation ? `
        <div class="panel motivation-banner">
          ${data.streak ? `<span class="streak-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c2.5 2.7 4 4.7 4 7.2A4.5 4.5 0 0 1 7.5 15c0-2.5 1.5-4.5 4.5-7.5Z"/><path d="M10.5 14.3c.6 1.4 1.8 2.2 3.2 2.7"/></svg>${data.streak}</span>` : ''}
          <p>${escapeHtml(data.motivation)}</p>
        </div>
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

      ${recapHtml(strip)}
      <div class="halfday-row">
        ${halfCard('AM', s.am)}
        ${halfCard('PM', s.pm)}
      </div>

      ${localStorage.getItem('selfup_sharing_enabled') !== 'false' ? `<div class="panel share-panel">
        <div class="panel-title"><h3>Your progress, beautifully told</h3><span class="share-private-note">You choose what to share</span></div>
        <p class="rating-sub share-intro">A ready-to-post recap of what you completed. Your account name and selected day identify the card; task names, email, budget, and private focus stay private.</p>
        <div class="achievement-card" id="achievement-card">
          <div class="achievement-card-top"><div class="achievement-brand"><span class="achievement-mark">SW</span><span>SMALL WINS</span></div><span class="achievement-card-kicker">${pct == null ? 'YOUR NEXT WIN STARTS HERE' : 'DAILY PROGRESS'}</span></div>
          <div class="achievement-score ${pct == null ? 'is-empty' : ''}">${pct == null ? 'Start small' : pct}<small>${pct == null ? '' : '%'}</small></div>
          <div class="achievement-rating" style="color:${color}">${pct == null ? 'A fresh start is still progress.' : escapeHtml(s.rating)}</div>
          <div class="achievement-date">${escapeHtml(DateUtil.label(date))}</div>
          <div class="achievement-identity">Completed by ${escapeHtml(shareName)}</div>
          <div class="achievement-card-rule"></div>
          <div class="achievement-metrics" style="--achievement-columns:${Math.max(1, shareStats.length)}">${shareStats.length ? shareStats.map((item) => `
            <div class="achievement-metric"><span>${item.label}</span><strong>${item.done}<small>/${item.total}</small></strong></div>
          `).join('') : '<div class="achievement-no-metrics">Make a plan. Show up. Count the small wins.</div>'}</div>
          <p class="achievement-invitation">Want to make progress too? Start with Small Wins.</p>
          <div class="achievement-card-footer"><span>${pct == null ? 'Your journey starts with one small win.' : 'Progress, not perfection.'}</span><span>#SmallWins</span></div>
          <div class="achievement-card-credit">Developed by Your Trusted Guy</div>
        </div>
        <p class="share-caption-label">CAPTION PREVIEW</p>
        <p class="share-caption" id="share-caption">${escapeHtml(buildShareMessage(data, date, shareName))}</p>
        <div class="share-actions">
          <button class="btn btn-primary btn-sm" id="share-achievement" type="button">Share card…</button>
          <button class="btn btn-ghost btn-sm" id="copy-share-caption" type="button">Copy caption</button>
          <button class="btn btn-ghost btn-sm" data-share="facebook" type="button">Facebook</button>
          <button class="btn btn-ghost btn-sm" data-share="instagram" type="button">Instagram</button>
          <button class="btn btn-ghost btn-sm" id="download-achievement" type="button">Save image</button>
        </div>
        <p class="share-platform-note">On mobile, “Share card” opens your device’s share sheet so you can choose Messenger, Facebook, or Instagram. Instagram and Facebook may require you to add the saved image in their app.</p>
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
    return `<div class="panel onboarding"><div class="panel-title"><h3>Start with a routine</h3></div>
      <p class="rating-sub" style="margin:0 0 12px">Keep it manageable. Choose a small start or a routine; everything can be changed later.</p>
      <div class="starter-row">${Object.keys(STARTERS).map((k) => `<button class="btn btn-ghost" data-starter="${k}" type="button">${k}</button>`).join('')}</div>
      <label class="onboarding-focus">What would you like to focus on this week?
        <input type="text" maxlength="140" id="onboarding-focus" placeholder="For example: make time for movement">
      </label>
      <div class="onboarding-sample">
        <p class="rating-sub" style="margin:12px 0 8px">Just looking around? Load a few example entries so you can see how scores, goals, and money totals work. They’re clearly labelled “Sample” and you can remove them any time in Settings.</p>
        <button class="btn btn-ghost btn-sm" data-sample-onboarding type="button" ${navigator.onLine ? '' : 'disabled'}>Explore with sample entries</button>
        <p class="form-error" id="onboarding-sample-error" aria-live="polite"></p>
      </div>
      <button class="link-btn" data-skip-onboarding type="button">I’ll set up my own</button></div>`;
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

  function wire(el, root, data, date) {
    const userId = (Api.getUser() || {}).id;
    const onboardingKey = `selfup_onboarded_${userId}`;
    el.querySelectorAll('[data-starter]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        for (const [period, title, points] of STARTERS[b.dataset.starter]) {
          await Api.post('/tasks', { task_date: DateUtil.today(), period, title, points });
        }
        await saveOnboardingFocus(el);
        localStorage.setItem(onboardingKey, '1');
        UI.toast('Your starting plan is ready. Adjust it any time.', { kind: 'win' });
        render(root);
      } catch (error) {
        UI.alert(error.message);
        b.disabled = false;
      }
    }));
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
      localStorage.setItem(`selfup_daily_brief_${AppState.date}`, '1');
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
      if (!localStorage.getItem(`selfup_daily_brief_${AppState.date}`)) setTimeout(showBrief, 450);
    }
    const shareBtn = el.querySelector('#share-achievement');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        await shareAchievement(buildShareMessage(data, date, shareName), 'native', data, date, shareName);
      });
    }

    el.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await shareAchievement(buildShareMessage(data, date, shareName), btn.dataset.share, data, date, shareName);
      });
    });

    const downloadBtn = el.querySelector('#download-achievement');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => downloadAchievementCard(data, date, shareName));
    }

    const copyCaptionBtn = el.querySelector('#copy-share-caption');
    if (copyCaptionBtn) {
      copyCaptionBtn.addEventListener('click', async () => {
        await copyShareCaption(buildShareMessage(data, date, shareName));
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
          <h2 id="daily-brief-title">Make today count.</h2>
          <p class="rating-sub">Here is what still needs your attention.</p>
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

  function buildAchievementCardContent(data, date, username = 'Small Wins member') {
    const hasScore = data.summary.percentage != null;
    return {
      brand: 'SMALL WINS',
      mark: 'SW',
      kicker: hasScore ? 'DAILY PROGRESS' : 'YOUR NEXT WIN STARTS HERE',
      score: hasScore ? String(data.summary.percentage) : null,
      rating: hasScore ? data.summary.rating : 'A fresh start is still progress.',
      date: DateUtil.label(date),
      username: username.trim() || 'Small Wins member',
      stats: buildShareStats(data),
      footer: hasScore ? 'Progress, not perfection.' : 'Your journey starts with one small win.',
      invitation: 'Want to make progress too? Start with Small Wins.',
      hashtag: '#SmallWins',
      developer: 'Developed by Your Trusted Guy',
    };
  }

  function buildShareMessage(data, date, username = 'Small Wins member') {
    const title = date === DateUtil.today() ? 'today' : DateUtil.label(date);
    const score = data.summary.percentage;
    const stats = buildShareStats(data)
      .map((metric) => `${metric.done}/${metric.total} ${metric.label.toLowerCase()}`)
      .join(' · ');
    const progress = score == null ? 'A fresh start is still progress.' : `My Small Wins score: ${score}% (${data.summary.rating}).`;
    const details = stats ? ` ${stats}.` : '';
    return `A little progress adds up. ${title === 'today' ? 'Today' : title}: ${progress}${details} — ${username.trim() || 'Small Wins member'}. Want to make progress too? Start with Small Wins. #SmallWins #DailyProgress`;
  }

  function drawAchievementCard(data, date, username) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    const card = buildAchievementCardContent(data, date, username);
    const score = card.score;
    const stats = card.stats;
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
    gradient.addColorStop(0, '#121824');
    gradient.addColorStop(0.58, '#202d3b');
    gradient.addColorStop(1, '#17232d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1350);
    ctx.fillStyle = 'rgba(79, 209, 174, 0.08)';
    ctx.beginPath();
    ctx.arc(900, 160, 260, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(232, 181, 77, 0.07)';
    ctx.beginPath();
    ctx.arc(100, 1240, 290, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4fd1ae';
    fillRoundedRect(ctx, 76, 80, 66, 66, 20);
    ctx.fillStyle = '#13232b';
    ctx.font = '700 27px Arial';
    ctx.fillText(card.mark, 88, 123);
    ctx.fillStyle = '#f5f7fa';
    ctx.font = '700 34px Arial';
    ctx.fillText(card.brand, 166, 123);
    ctx.fillStyle = '#a4b0ba';
    ctx.font = '600 19px Arial';
    ctx.letterSpacing = '4px';
    ctx.fillText(card.kicker, 78, 222);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = '#f5f7fa';
    if (score === null) {
      ctx.font = '700 112px Arial';
      ctx.fillText('START SMALL', 76, 526);
    } else {
      ctx.font = '700 228px Arial';
      ctx.fillText(score, 70, 526);
      const scoreWidth = ctx.measureText(score).width;
      ctx.fillStyle = '#a4b0ba';
      ctx.font = '700 64px Arial';
      ctx.fillText('%', Math.min(780, 80 + scoreWidth), 514);
    }
    ctx.fillStyle = '#4fd1ae';
    ctx.font = '700 39px Arial';
    ctx.fillText(card.rating, 80, 612);
    ctx.fillStyle = '#a4b0ba';
    ctx.font = '500 28px Arial';
    ctx.fillText(card.date, 80, 668);
    ctx.fillStyle = '#d8e1e6';
    ctx.font = '600 25px Arial';
    ctx.fillText(`Completed by ${card.username}`, 80, 716, 920);

    ctx.strokeStyle = 'rgba(245,247,250,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 756);
    ctx.lineTo(1000, 756);
    ctx.stroke();
    ctx.fillStyle = '#f5f7fa';
    ctx.font = '700 20px Arial';
    ctx.fillText('SMALL WINS, MADE VISIBLE', 80, 812);

    const gap = 18;
    const columns = stats.length === 1 ? 1 : 2;
    const cellWidth = (920 - gap * (columns - 1)) / columns;
    const cellHeight = 126;
    stats.slice(0, 4).forEach((metric, index) => {
      const x = 80 + (index % columns) * (cellWidth + gap);
      const y = 844 + Math.floor(index / columns) * (cellHeight + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      fillRoundedRect(ctx, x, y, cellWidth, cellHeight, 20);
      ctx.fillStyle = '#a4b0ba';
      ctx.font = '600 21px Arial';
      ctx.fillText(metric.label.toUpperCase(), x + 24, y + 40);
      ctx.fillStyle = '#f5f7fa';
      ctx.font = '700 45px Arial';
      ctx.fillText(`${metric.done}/${metric.total}`, x + 24, y + 94);
    });
    if (!stats.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      fillRoundedRect(ctx, 80, 844, 920, 160, 20);
      ctx.fillStyle = '#d8e1e6';
      ctx.font = '600 28px Arial';
      ctx.fillText('Nothing logged for this day yet.', 108, 888);
      ctx.fillStyle = '#a4b0ba';
      ctx.font = '500 23px Arial';
      ctx.fillText('Make a plan. Show up. Count the small wins.', 108, 934);
    }

    ctx.fillStyle = '#4fd1ae';
    ctx.font = '600 24px Arial';
    ctx.fillText(card.invitation, 80, 1160, 920);
    ctx.fillStyle = '#d8e1e6';
    ctx.font = '500 25px Arial';
    ctx.fillText(card.footer, 80, 1208);
    ctx.fillStyle = '#4fd1ae';
    ctx.font = '700 21px Arial';
    ctx.fillText(card.hashtag, 80, 1262);
    ctx.fillStyle = '#81909a';
    ctx.font = '500 20px Arial';
    ctx.fillText(card.developer, 80, 1305);
    return canvas;
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

  function downloadAchievementCard(data, date, username) {
    const canvas = drawAchievementCard(data, date, username);
    const link = document.createElement('a');
    link.download = `small-wins-${date}-progress.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async function shareAchievement(message, platform, data, date, username) {
    let imageFile;
    try {
      imageFile = dataUrlToFile(
        drawAchievementCard(data, date, username).toDataURL('image/png'),
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
      downloadAchievementCard(data, date, username);
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
      downloadAchievementCard(data, date, username);
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

  return { render, buildShareMessage, buildShareStats, buildAchievementCardContent };
})();

if (typeof module !== 'undefined') module.exports = PageDashboard;
