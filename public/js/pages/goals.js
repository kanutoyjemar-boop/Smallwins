const PageGoals = (() => {
  async function render(el) {
    const date = AppState.date;
    const [goals, insights, recovery, recoveryWeek] = await Promise.all([
      Api.get(`/goals?date=${date}`),
      Api.get(`/dashboard/week?date=${date}`),
      Api.get(`/recovery?date=${date}`),
      Api.get(`/recovery/week?date=${date}`),
    ]);

    el.innerHTML = template(date, goals, insights, recovery, recoveryWeek);
    wire(el, date);
  }

  function template(date, goals, insights, recovery, recoveryWeek) {
    const goalSuggestions = [
      ...goals.map((goal) => goal.title),
      'Drink more water',
      'Read for 10 minutes',
      'Take a short walk',
    ];
    const focusSuggestions = [
      insights.focus,
      'Make time for movement',
      'Get enough rest',
      'Finish one important task',
    ];
    const weekly = insights.weekly || { activeDays: 0, average: 0, bestDay: null, completionRate: 0 };
    const previous = insights.previousWeekly || { activeDays: 0, average: 0 };
    const recap = insights.recap || {
      win: 'A fresh week is a chance to start wherever you are.',
      nextStep: 'Choose one small, realistic thing to plan when you’re ready.',
    };
    const coachTip = recoveryWeek.coachTip || recap.nextStep;
    const reflection = insights.reflection || null;
    const comparison = weekly.activeDays && previous.activeDays
      ? `${weekly.average - previous.average > 0 ? '+' : ''}${weekly.average - previous.average} pts`
      : '—';
    const weeklySummaryText = weekly.activeDays
      ? `You had a plan on ${weekly.activeDays} day${weekly.activeDays === 1 ? '' : 's'} this week, averaging ${weekly.average}%. This is a snapshot, not a grade. ${previous.activeDays ? `Last week’s snapshot was ${previous.average}%.` : ''}`
      : `No scored days yet this week. Rest and open space count, too. ${previous.activeDays ? `Last week’s snapshot was ${previous.average}%.` : 'When you’re ready, choose one small plan.'}`;

    return `
      <div class="date-nav">
        <button data-nav="-1" aria-label="Previous day">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1" aria-label="Next day">›</button>
      </div>

      <div class="panel">
        <div class="section-label" style="margin-top:0">Weekly momentum</div>
        <div class="stat-grid">
          <div class="stat-card" style="--accent:var(--tasks)">
            <div class="sc-label">Days with a plan</div>
            <div class="sc-value">${weekly.activeDays}/${7 - (insights.restDays || []).length}</div>
          </div>
          <div class="stat-card" style="--accent:var(--money)">
            <div class="sc-label">Average progress</div>
            <div class="sc-value">${weekly.activeDays ? `${weekly.average}%` : '—'}</div>
          </div>
          <div class="stat-card" style="--accent:var(--body)">
            <div class="sc-label">Best day</div>
            <div class="sc-value">${weekly.bestDay ? DateUtil.label(weekly.bestDay) : '—'}</div>
          </div>
          <div class="stat-card" style="--accent:var(--agenda)">
            <div class="sc-label">Days with activity</div>
            <div class="sc-value">${weekly.completionRate}%</div>
          </div>
          <div class="stat-card" style="--accent:var(--tasks)">
            <div class="sc-label">Focus check-ins</div>
            <div class="sc-value">${insights.focus ? `${insights.focusCheckins || 0}/7` : '—'}</div>
          </div>
        </div>
      </div>

      <div class="panel weekly-review-panel">
        <div class="section-label" style="margin-top:0">Weekly review</div>
        <p class="rating-sub" style="margin:0 0 10px">${escapeHtml(weeklySummaryText)}</p>
        <p class="meta">Small steps can compound into meaningful change. There’s no required percentage or perfect pace—choose what feels sustainable.</p>
        ${weeklyActivityHtml(insights.activity)}
        <div class="review-highlight">
          <span>Change from last week</span>
          <strong>${comparison}</strong>
        </div>
        <div class="review-highlight">
          <span>Best day</span>
          <strong>${weekly.bestDay ? DateUtil.label(weekly.bestDay) : 'Start when you’re ready'}</strong>
        </div>
        <div class="weekly-recap-note">
          <strong>A win</strong>
          <p>${escapeHtml(recap.win)}</p>
        </div>
        <div class="weekly-suggestion">
          <strong>${recoveryWeek.coachTip ? 'A gentle recovery idea' : 'One gentle idea'}</strong>
          <p>${escapeHtml(coachTip)}</p>
        </div>
        <label style="display:block; margin-top:12px">This week’s focus
          <input type="text" id="week-focus" list="suggestions-week-focus" maxlength="140" placeholder="The one habit or outcome that matters most" value="${escapeHtml(insights.focus || '')}">
        </label>
        ${UI.suggestions('week-focus', 'Weekly focus', focusSuggestions)}
        <details class="rest-day-planner">
          <summary>Choose intentional rest days</summary>
          <p class="meta">Rest is part of a sustainable plan. Empty days stay unscored rather than counting against you.</p>
          <div class="rest-day-options">${[['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]].map(([label, day]) => `
            <label><input type="checkbox" data-rest-day value="${day}" ${(insights.restDays || []).includes(day) ? 'checked' : ''}>${label}</label>`).join('')}
          </div>
        </details>
        <button class="btn btn-primary btn-sm" id="save-week-focus" data-week-start="${insights.weekStart || ''}" type="button" style="margin-top:10px">Save weekly plan</button>
        <p class="form-success" id="week-focus-saved" aria-live="polite"></p>
      </div>
      ${pendingItemsHtml(insights.pendingAgenda || [], insights.pendingTasks || [])}

      <div class="panel recovery-panel">
        <div class="section-label" style="margin-top:0">Sleep &amp; recovery</div>
        <p class="rating-sub" style="margin:0 0 10px">Optional and private. Check in on how you feel; this does not affect your score.</p>
        <div class="recovery-week-summary">
          <span>${recoveryWeek.checkins} check-in${recoveryWeek.checkins === 1 ? '' : 's'} this week</span>
          ${recoveryWeek.averageSleep != null ? `<span>Sleep ${recoveryWeek.averageSleep}h</span>` : ''}
          ${recoveryWeek.averageEnergy != null ? `<span>Energy ${recoveryWeek.averageEnergy}/5</span>` : ''}
          ${recoveryWeek.averageStress != null ? `<span>Stress ${recoveryWeek.averageStress}/5</span>` : ''}
        </div>
        <form class="add-form" id="recovery-form">
          <label>Sleep duration (hours)
            <input id="recovery-sleep-hours" type="number" min="0" max="24" step="0.25" placeholder="e.g. 7.5" value="${recovery && recovery.sleep_hours != null ? recovery.sleep_hours : ''}">
          </label>
          <div class="row recovery-rating-row">
            <label>Sleep quality
              <select id="recovery-sleep-quality">
                <option value="">Not logged</option>
                ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${recovery && Number(recovery.sleep_quality) === n ? 'selected' : ''}>${n} — ${['', 'Low', 'Fair', 'Okay', 'Good', 'Great'][n]}</option>`).join('')}
              </select>
            </label>
            <label>Energy
              <select id="recovery-energy">
                <option value="">Not logged</option>
                ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${recovery && Number(recovery.energy) === n ? 'selected' : ''}>${n} — ${['', 'Low', 'Fair', 'Okay', 'Good', 'High'][n]}</option>`).join('')}
              </select>
            </label>
          </div>
          <label>Stress
            <select id="recovery-stress">
              <option value="">Not logged</option>
              ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${recovery && Number(recovery.stress) === n ? 'selected' : ''}>${n} — ${['', 'Low', 'Mild', 'Moderate', 'High', 'Very high'][n]}</option>`).join('')}
            </select>
          </label>
          <textarea id="recovery-note" rows="2" maxlength="500" placeholder="Anything you want to note about recovery?">${recovery ? escapeHtml(recovery.note || '') : ''}</textarea>
          <div class="row">
            <button type="submit" class="btn btn-primary btn-sm">Save check-in</button>
            ${recovery ? '<button type="button" class="btn btn-ghost btn-sm" id="clear-recovery">Clear check-in</button>' : ''}
          </div>
        </form>
      </div>

      <div class="panel">
        <div class="section-label" style="margin-top:0">Daily focus goals</div>
        ${!goals.length ? '<p class="empty-state">Nothing scheduled yet. Add your next win.</p>' : goals.map(goalRow).join('')}
        <form class="add-form" id="goal-form">
          <input type="text" id="goal-title" list="suggestions-goal-title" placeholder="What would you like to work toward?" required maxlength="140">
          ${UI.suggestions('goal-title', 'Goal name', goalSuggestions)}
          <div class="row">
            <input type="number" id="goal-target" placeholder="Target" min="1" value="1">
            <input type="text" id="goal-unit" list="suggestions-goal-unit" placeholder="times" value="times" aria-label="Goal unit, such as times or minutes">
          </div>
          ${UI.suggestions('goal-unit', 'Goal unit', ['times', 'minutes', 'pages', 'glasses', 'kilometers'])}
          <button type="submit" class="btn btn-primary btn-sm">Add goal</button>
        </form>
      </div>

      <div class="panel">
        <div class="section-label" style="margin-top:0">Daily reflection</div>
        <form class="add-form" id="reflection-form">
          <div class="row">
            <select id="reflection-mood">
              <option value="steady" ${reflection && reflection.mood === 'steady' ? 'selected' : ''}>Steady</option>
              <option value="great" ${reflection && reflection.mood === 'great' ? 'selected' : ''}>Great</option>
              <option value="tired" ${reflection && reflection.mood === 'tired' ? 'selected' : ''}>Tired</option>
              <option value="overwhelmed" ${reflection && reflection.mood === 'overwhelmed' ? 'selected' : ''}>Overwhelmed</option>
            </select>
          </div>
          <textarea id="reflection-wins" rows="2" placeholder="What went well today?">${reflection ? escapeHtml(reflection.wins || '') : ''}</textarea>
          ${UI.suggestionButtons('reflection-wins', 'Reflection ideas', ['I made time to rest', 'I finished one thing', 'I asked for help'])}
          <textarea id="reflection-note" rows="3" placeholder="One honest note for tomorrow...">${reflection ? escapeHtml(reflection.note || '') : ''}</textarea>
          ${UI.suggestionButtons('reflection-note', 'Notes for tomorrow', ['Tomorrow I can start by…', 'One thing I want to remember…', 'What would make tomorrow easier?'])}
          <button type="submit" class="btn btn-primary btn-sm">Save reflection</button>
        </form>
      </div>
    `;
  }

  function weeklyActivityHtml(activity) {
    if (!activity) return '';
    const rows = [
      ['Tasks', activity.tasks_planned, activity.tasks_completed],
      ['Workouts', activity.workouts_planned, activity.workouts_completed],
      ['Meals', activity.meals_planned, activity.meals_completed],
      ['Agenda', activity.agenda_planned, activity.agenda_completed],
    ];
    const planned = rows.reduce((total, [, count]) => total + Number(count || 0), 0);
    const completed = rows.reduce((total, [, , count]) => total + Number(count || 0), 0);
    return `<div class="weekly-activity">
      <div class="review-highlight"><span>Progress on planned items</span><strong>${completed}/${planned}</strong></div>
      <div class="weekly-activity-grid">${rows.map(([label, count, done]) => `
        <div><span>${label}</span><strong>${Number(done || 0)}/${Number(count || 0)}</strong></div>`).join('')}
      </div>
    </div>`;
  }

  function pendingItemsHtml(agenda, tasks) {
    const items = [
      ...agenda.map((item) => ({ ...item, date: String(item.item_date).slice(0, 10), kind: 'schedule', detail: 'Agenda' })),
      ...tasks.map((item) => ({ ...item, date: String(item.task_date).slice(0, 10), kind: 'task', detail: `${item.period} task` })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.detail.localeCompare(b.detail));
    if (!items.length) return '';
    return `<div class="panel">
      <div class="section-label" style="margin-top:0">Plans to revisit</div>
      <p class="meta">Plans can change. Move anything that still matters to another day; no need to catch up all at once.</p>
      ${items.map((item) => `<div class="list-item weekly-carryover">
        <div class="grow"><div class="title">${escapeHtml(item.title)}</div><div class="meta">${escapeHtml(item.detail)} · ${escapeHtml(DateUtil.label(item.date))}</div></div>
        <label class="sr-only" for="move-${item.kind}-${item.id}">New date for ${escapeHtml(item.title)}</label>
        <input id="move-${item.kind}-${item.id}" type="date" data-move-date="${item.id}" data-move-kind="${item.kind}" min="${DateUtil.today()}" value="${DateUtil.addDays(DateUtil.today(), 1)}">
        <button class="btn btn-ghost btn-sm" type="button" data-move-item="${item.id}" data-move-kind="${item.kind}">Move</button>
      </div>`).join('')}
    </div>`;
  }

  function goalRow(goal) {
    const pct = Math.min(100, Math.round((Number(goal.progress || 0) / Math.max(Number(goal.target || 1), 1)) * 100));
    return `
      <div class="list-item ${goal.completed ? 'done' : ''}">
        <div class="grow">
          <button type="button" class="goal-edit-button title" data-edit-goal="${goal.id}" data-current="${escapeHtml(goal.title)}" aria-label="Rename goal: ${escapeHtml(goal.title)}">${escapeHtml(goal.title)}</button>
          <button type="button" class="goal-edit-button meta" data-edit-target="${goal.id}" data-target="${Number(goal.target || 1)}" data-unit="${escapeHtml(goal.unit || 'times')}" aria-label="Edit target for ${escapeHtml(goal.title)}">${Number(goal.progress || 0)}/${Number(goal.target || 1)} ${escapeHtml(goal.unit || 'times')}${goal.completed ? ' · Done' : ''}</button>
          <div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:${pct}%; background:${goal.completed ? 'var(--excellent)' : 'var(--tasks)'}"></div></div>
        </div>
        <div class="goal-stepper">
          <button type="button" class="goal-step" data-goal-step="-1" data-goal-id="${goal.id}" data-progress="${Number(goal.progress || 0)}" aria-label="Decrease progress" ${Number(goal.progress || 0) <= 0 ? 'disabled' : ''}>−</button>
          <button type="button" class="goal-step" data-goal-step="1" data-goal-id="${goal.id}" data-progress="${Number(goal.progress || 0)}" aria-label="Increase progress">+</button>
        </div>
        <button class="icon-x" data-delete-goal="${goal.id}" aria-label="Delete goal">✕</button>
      </div>
    `;
  }

  function wire(el, date) {
    el.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(AppState.date, Number(btn.dataset.nav));
        render(el);
      });
    });

    el.querySelector('#goal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('goal-title').value.trim();
      if (!title) return;
      await Api.post('/goals', {
        goal_date: date,
        title,
        target: Number(document.getElementById('goal-target').value) || 1,
        progress: 0,
        unit: document.getElementById('goal-unit').value.trim() || 'times',
      });
      render(el);
    });

    el.querySelector('#save-week-focus').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const focusInput = el.querySelector('#week-focus');
      button.disabled = true;
      try {
        await Api.put('/dashboard/week/focus', {
          week_start: button.dataset.weekStart,
          focus: focusInput.value.trim(),
          rest_days: Array.from(el.querySelectorAll('[data-rest-day]:checked'), (input) => Number(input.value)),
        });
        el.querySelector('#week-focus-saved').textContent = 'Focus saved to your account.';
      } catch (error) {
        UI.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });

    el.querySelectorAll('[data-move-item]').forEach((button) => {
      button.addEventListener('click', async () => {
        const dateInput = el.querySelector(`[data-move-date="${button.dataset.moveItem}"][data-move-kind="${button.dataset.moveKind}"]`);
        if (!dateInput.value) {
          UI.alert('Choose a new date first.');
          return;
        }
        button.disabled = true;
        try {
          const task = button.dataset.moveKind === 'task';
          await Api.patch(`/${task ? 'tasks' : 'schedule'}/${button.dataset.moveItem}`, task
            ? { task_date: dateInput.value }
            : { item_date: dateInput.value });
          UI.toast('Item rescheduled.');
          render(el);
        } catch (error) {
          UI.alert(error.message);
          button.disabled = false;
        }
      });
    });

    el.querySelectorAll('[data-goal-step]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const next = Math.max(0, Number(btn.dataset.progress) + Number(btn.dataset.goalStep));
        btn.disabled = true;
        await Api.patch(`/goals/${btn.dataset.goalId}`, { progress: next });
        render(el);
      });
    });

    el.querySelectorAll('[data-edit-goal]').forEach((label) => {
      label.addEventListener('click', async () => {
        const next = await UI.prompt('Edit goal:', label.dataset.current);
        if (next === null || !next.trim() || next.trim() === label.dataset.current) return;
        await Api.patch(`/goals/${label.dataset.editGoal}`, { title: next.trim().slice(0, 140) });
        render(el);
      });
    });

    el.querySelectorAll('[data-edit-target]').forEach((label) => {
      label.addEventListener('click', async () => {
        const input = await UI.prompt('Edit target and unit (for example: 5 times):', `${label.dataset.target} ${label.dataset.unit}`);
        if (input === null) return;
        const match = input.trim().match(/^(\d+)\s*(.*)$/);
        if (!match || Number(match[1]) < 1) {
          UI.alert('Please start with a target number of 1 or more, like "5 times".');
          return;
        }
        await Api.patch(`/goals/${label.dataset.editTarget}`, {
          target: Number(match[1]),
          unit: match[2].trim().slice(0, 30) || label.dataset.unit,
        });
        render(el);
      });
    });

    el.querySelectorAll('[data-delete-goal]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!await UI.confirm('Delete this goal?')) return;
        await Api.del(`/goals/${btn.dataset.deleteGoal}`);
        render(el);
      });
    });

    el.querySelector('#reflection-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await Api.post('/reflections', {
        entry_date: date,
        mood: document.getElementById('reflection-mood').value,
        wins: document.getElementById('reflection-wins').value.trim() || null,
        note: document.getElementById('reflection-note').value.trim() || null,
      });
      render(el);
    });

    el.querySelector('#recovery-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = (selector) => {
        const field = el.querySelector(selector);
        return field.value === '' ? null : Number(field.value);
      };
      try {
        await Api.put('/recovery', {
          entry_date: date,
          sleep_hours: value('#recovery-sleep-hours'),
          sleep_quality: value('#recovery-sleep-quality'),
          energy: value('#recovery-energy'),
          stress: value('#recovery-stress'),
          note: el.querySelector('#recovery-note').value.trim(),
        });
        render(el);
      } catch (error) {
        UI.toast(error.message);
      }
    });

    const clearRecovery = el.querySelector('#clear-recovery');
    if (clearRecovery) {
      clearRecovery.addEventListener('click', async () => {
        try {
          await Api.put('/recovery', { entry_date: date });
          render(el);
        } catch (error) {
          UI.toast(error.message);
        }
      });
    }
  }

  return { render };
})();
