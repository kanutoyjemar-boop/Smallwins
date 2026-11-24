const PageGoals = (() => {
  async function render(el) {
    const date = AppState.date;
    const [goals, insights] = await Promise.all([
      Api.get(`/goals?date=${date}`),
      Api.get(`/dashboard/week`),
    ]);

    el.innerHTML = template(date, goals, insights);
    wire(el, date);
  }

  function template(date, goals, insights) {
    const weekly = insights.weekly || { activeDays: 0, average: 0, bestDay: null, completionRate: 0 };
    const reflection = insights.reflection || null;

    return `
      <div class="date-nav">
        <button data-nav="-1">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1">›</button>
      </div>

      <div class="panel">
        <div class="section-label" style="margin-top:0">Weekly momentum</div>
        <div class="stat-grid">
          <div class="stat-card" style="--accent:var(--tasks)">
            <div class="sc-label">Active days</div>
            <div class="sc-value">${weekly.activeDays}/7</div>
          </div>
          <div class="stat-card" style="--accent:var(--money)">
            <div class="sc-label">Avg score</div>
            <div class="sc-value">${weekly.average}%</div>
          </div>
          <div class="stat-card" style="--accent:var(--body)">
            <div class="sc-label">Best day</div>
            <div class="sc-value">${weekly.bestDay ? DateUtil.label(weekly.bestDay) : '—'}</div>
          </div>
          <div class="stat-card" style="--accent:var(--agenda)">
            <div class="sc-label">Consistency</div>
            <div class="sc-value">${weekly.completionRate}%</div>
          </div>
        </div>
      </div>

      <div class="panel weekly-review-panel">
        <div class="section-label" style="margin-top:0">Weekly review</div>
        <p class="rating-sub" style="margin:0 0 10px">You logged ${weekly.activeDays} active day${weekly.activeDays === 1 ? '' : 's'} and averaged ${weekly.average}%. Keep the next week focused and realistic.</p>
        <div class="review-highlight">
          <span>Best day</span>
          <strong>${weekly.bestDay ? DateUtil.label(weekly.bestDay) : 'Start today'}</strong>
        </div>
        <label style="display:block; margin-top:12px">Next week focus
          <input type="text" id="next-week-focus" maxlength="140" placeholder="The one habit or outcome that matters most">
        </label>
        <button class="btn btn-primary btn-sm" id="save-week-focus" type="button" style="margin-top:10px">Save focus</button>
        <p class="form-success" id="week-focus-saved" aria-live="polite"></p>
      </div>

      <div class="panel">
        <div class="section-label" style="margin-top:0">Daily focus goals</div>
        ${!goals.length ? '<p class="empty-state">Nothing scheduled yet. Add your next win.</p>' : goals.map(goalRow).join('')}
        <form class="add-form" id="goal-form">
          <input type="text" id="goal-title" placeholder="Goal for today" required maxlength="140">
          <div class="row">
            <input type="number" id="goal-target" placeholder="Target" min="1" value="1">
            <input type="text" id="goal-unit" placeholder="times" value="times">
          </div>
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
          <textarea id="reflection-note" rows="3" placeholder="One honest note for tomorrow...">${reflection ? escapeHtml(reflection.note || '') : ''}</textarea>
          <button type="submit" class="btn btn-primary btn-sm">Save reflection</button>
        </form>
      </div>
    `;
  }

  function goalRow(goal) {
    const pct = Math.min(100, Math.round((Number(goal.progress || 0) / Math.max(Number(goal.target || 1), 1)) * 100));
    return `
      <div class="list-item">
        <div class="grow">
          <div class="title">${escapeHtml(goal.title)}</div>
          <div class="meta">${Number(goal.progress || 0)}/${Number(goal.target || 1)} ${escapeHtml(goal.unit || 'times')}</div>
          <div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:${pct}%; background:${goal.completed ? 'var(--excellent)' : 'var(--tasks)'}"></div></div>
        </div>
        <div class="goal-steppers">
          <button class="icon-x" type="button" data-goal-step="-1" data-goal-id="${goal.id}" data-progress="${Number(goal.progress || 0)}" data-target="${Number(goal.target || 1)}" aria-label="Decrease progress" ${Number(goal.progress || 0) <= 0 ? 'disabled' : ''}>−</button>
          <button class="icon-x" type="button" data-goal-step="1" data-goal-id="${goal.id}" data-progress="${Number(goal.progress || 0)}" data-target="${Number(goal.target || 1)}" aria-label="Increase progress">+</button>
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

    const focusInput = el.querySelector('#next-week-focus');
    const savedFocus = localStorage.getItem('selfup_next_week_focus') || '';
    if (focusInput) focusInput.value = savedFocus;
    el.querySelector('#save-week-focus').addEventListener('click', () => {
      localStorage.setItem('selfup_next_week_focus', focusInput.value.trim());
      el.querySelector('#week-focus-saved').textContent = 'Focus saved.';
      setTimeout(() => { el.querySelector('#week-focus-saved').textContent = ''; }, 2500);
    });

    el.querySelectorAll('[data-goal-step]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const target = Number(btn.dataset.target);
        const progress = Math.max(0, Number(btn.dataset.progress) + Number(btn.dataset.goalStep));
        await Api.patch(`/goals/${btn.dataset.goalId}`, { progress, completed: progress >= target });
        render(el);
      });
    });

    el.querySelectorAll('[data-delete-goal]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this goal?')) return;
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
  }

  return { render };
})();
