const PageBody = (() => {
  let activeTab = 'workouts';
  const ACTIVITIES = [
    'Push workout', 'Pull workout', 'Legs workout', 'Upper body', 'Lower body',
    'Strength circuit', 'Mobility', 'Stretching', 'Yoga', 'Pilates',
    'Walk', 'Run', 'Jog', 'Tempo run', 'Recovery walk',
    'Swim', 'Cycling', 'Bike ride', 'Gym cardio', 'HIIT',
    'Pickleball', 'Tennis', 'Basketball', 'Football', 'Soccer',
    'Hiking', 'Rowing', 'Martial arts', 'Volleyball', 'Other'
  ];
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

  async function render(el) {
    const date = AppState.date;
    el.innerHTML = `
      <div class="date-nav">
        <button data-nav="-1">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1">›</button>
      </div>
      <div class="tabs">
        <div class="tab ${activeTab === 'workouts' ? 'active' : ''}" data-tab="workouts">Workouts</div>
        <div class="tab ${activeTab === 'diet' ? 'active' : ''}" data-tab="diet">Diet plan</div>
      </div>
      <div id="body-tab-content"><div class="loader">Loading…</div></div>
    `;

    el.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(AppState.date, Number(btn.dataset.nav));
        render(el);
      });
    });
    el.querySelectorAll('[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        render(el);
      });
    });

    const target = el.querySelector('#body-tab-content');
    if (activeTab === 'workouts') await renderWorkouts(target, date);
    else await renderDiet(target, date);
  }

  // ---------------- Workouts ----------------
  async function renderWorkouts(el, date) {
    const [workouts, routines] = await Promise.all([
      Api.get(`/workouts?date=${date}`),
      Api.get('/templates?kind=workouts'),
    ]);
    const done = workouts.filter((w) => w.done).length;
    const totalMinutes = workouts.reduce((sum, w) => sum + Number(w.duration_minutes || 0), 0);
    const strengthSessions = workouts.filter((w) => /push|pull|legs|strength|upper|lower|gym|circuit|hiit/i.test(w.activity_type)).length;
    const cardioSessions = workouts.filter((w) => /walk|run|jog|tempo|swim|cycling|bike|cardio|hiit|row/i.test(w.activity_type)).length;
    const sportSessions = workouts.filter((w) => /pickleball|tennis|basketball|football|soccer|volleyball|hiking|martial/i.test(w.activity_type)).length;

    el.innerHTML = `
      <div class="panel panel-accent body-summary-panel" style="--accent:var(--body)">
        <div class="panel-title"><h3>Movement summary</h3><span class="count">${done}/${workouts.length} complete</span></div>
        <div class="body-summary-grid">
          <div class="body-summary-card">
            <span>Total</span>
            <strong>${totalMinutes}m</strong>
          </div>
          <div class="body-summary-card">
            <span>Strength</span>
            <strong>${strengthSessions}</strong>
          </div>
          <div class="body-summary-card">
            <span>Cardio</span>
            <strong>${cardioSessions}</strong>
          </div>
          <div class="body-summary-card">
            <span>Sports</span>
            <strong>${sportSessions}</strong>
          </div>
        </div>
      </div>

      <div class="panel panel-accent" style="--accent:var(--body)">
        <div class="panel-title"><h3>Today's activity</h3><span class="count">${done}/${workouts.length}</span></div>
        ${!workouts.length ? `<button class="btn btn-ghost btn-block" id="copy-workouts" type="button" style="margin-bottom:12px">Copy yesterday's workouts</button>` : ''}
        ${workouts.length ? workouts.map(workoutRow).join('') : '<p class="empty-state">No workouts planned.</p>'}
        <form class="add-form" id="workout-form">
          <div class="row">
            <select id="w-type">${ACTIVITIES.map((a) => `<option>${a}</option>`).join('')}</select>
            <input type="number" id="w-duration" placeholder="minutes" min="0" style="max-width:90px">
          </div>
          <input type="text" id="w-notes" placeholder="Focus / notes (optional)" maxlength="160">
          <button type="submit" class="btn btn-primary btn-sm">Add workout</button>
        </form>
      </div>

      <div class="panel routine-panel">
        <div class="panel-title"><h3>Training templates</h3><span class="count">${routines.length} saved</span></div>
        <div class="row routine-actions">
          <button class="btn btn-ghost btn-sm" id="save-workout-routine" type="button" ${workouts.length ? '' : 'disabled'}>Save today's training</button>
          ${routines.length ? `<select id="workout-routine-select" aria-label="Choose a training template"><option value="">Apply a template…</option>${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${routineManagerHtml(routines)}
      </div>
    `;
    wireRoutineManager(el, () => renderWorkouts(el, date));

    el.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('click', async () => {
        await Api.patch(`/workouts/${box.dataset.toggle}`, { done: box.dataset.done !== 'true' });
        renderWorkouts(el, date);
      });
    });
    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this workout?')) return;
        await Api.del(`/workouts/${btn.dataset.del}`);
        renderWorkouts(el, date);
      });
    });
    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextDuration = prompt('Edit duration (minutes):', row.dataset.duration);
        if (nextDuration === null || isNaN(Number(nextDuration))) return;
        const nextNotes = prompt('Edit notes (blank for none):', row.dataset.notes || '');
        if (nextNotes === null) return;
        await Api.patch(`/workouts/${row.dataset.edit}`, { duration_minutes: Number(nextDuration), notes: nextNotes.trim() || null });
        renderWorkouts(el, date);
      });
    });
    el.querySelector('#workout-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      await Api.post('/workouts', {
        workout_date: date,
        activity_type: document.getElementById('w-type').value,
        duration_minutes: Number(document.getElementById('w-duration').value) || 0,
        notes: document.getElementById('w-notes').value.trim() || null,
      });
      renderWorkouts(el, date);
    });
    const saveRoutine = el.querySelector('#save-workout-routine');
    if (saveRoutine) saveRoutine.addEventListener('click', async () => {
      const name = prompt('Name this training template:', 'Strength and cardio session');
      if (!name || !name.trim()) return;
      await Api.post('/templates', { name: name.trim(), kind: 'workouts', items: workouts.map((workout) => ({ activity_type: workout.activity_type, duration_minutes: workout.duration_minutes, notes: workout.notes, points: workout.points })) });
      renderWorkouts(el, date);
    });
    const routineSelect = el.querySelector('#workout-routine-select');
    if (routineSelect) routineSelect.addEventListener('change', async () => {
      if (!routineSelect.value) return;
      await Api.post(`/templates/${routineSelect.value}/apply`, { date });
      renderWorkouts(el, date);
    });
    const copyWorkoutsBtn = el.querySelector('#copy-workouts');
    if (copyWorkoutsBtn) {
      copyWorkoutsBtn.addEventListener('click', async () => {
        copyWorkoutsBtn.disabled = true;
        copyWorkoutsBtn.textContent = 'Copying…';
        const yesterday = DateUtil.addDays(date, -1);
        const prev = await Api.get(`/workouts?date=${yesterday}`);
        if (!prev.length) alert("Yesterday didn't have any workouts to copy.");
        for (const w of prev) {
          await Api.post('/workouts', { workout_date: date, activity_type: w.activity_type, duration_minutes: w.duration_minutes, notes: w.notes, points: w.points });
        }
        renderWorkouts(el, date);
      });
    }
  }

  function workoutRow(w) {
    return `
      <div class="list-item ${w.done ? 'done' : ''}">
        <div class="checkbox ${w.done ? 'checked' : ''}" data-toggle="${w.id}" data-done="${w.done}">
          ${w.done ? checkIcon() : ''}
        </div>
        <div class="grow workout-meta-block" data-edit="${w.id}" data-duration="${w.duration_minutes}" data-notes="${escapeHtml(w.notes || '')}">
          <div class="title">${escapeHtml(w.activity_type)}</div>
          <div class="meta">${w.duration_minutes ? w.duration_minutes + ' min' : 'no duration set'}${w.notes ? ' · ' + escapeHtml(w.notes) : ''}</div>
        </div>
        <span class="pts-chip">+${w.points}</span>
        <button class="icon-x" data-del="${w.id}">✕</button>
      </div>
    `;
  }

  // ---------------- Diet ----------------
  async function renderDiet(el, date) {
    const entries = await Api.get(`/diet?date=${date}`);
    const eaten = entries.filter((d) => d.eaten).length;
    el.innerHTML = `
      <div class="panel panel-accent" style="--accent:var(--body)">
        <div class="panel-title"><h3>Meal plan</h3><span class="count">${eaten}/${entries.length}</span></div>
        ${!entries.length ? `<button class="btn btn-ghost btn-block" id="copy-diet" type="button" style="margin-bottom:12px">Copy yesterday's meal plan</button>` : ''}
        ${entries.length ? entries.map(dietRow).join('') : '<p class="empty-state">Nothing planned to eat yet.</p>'}
        <form class="add-form" id="diet-form">
          <div class="row">
            <select id="d-meal">${MEALS.map((m) => `<option>${m}</option>`).join('')}</select>
            <input type="number" id="d-cal" placeholder="kcal (optional)" min="0" style="max-width:120px">
          </div>
          <input type="text" id="d-food" placeholder="What should you eat?" required maxlength="160">
          <button type="submit" class="btn btn-primary btn-sm">Add to plan</button>
        </form>
      </div>
    `;

    el.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('click', async () => {
        await Api.patch(`/diet/${box.dataset.toggle}`, { eaten: box.dataset.done !== 'true' });
        renderDiet(el, date);
      });
    });
    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this meal entry?')) return;
        await Api.del(`/diet/${btn.dataset.del}`);
        renderDiet(el, date);
      });
    });
    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextFood = prompt('Edit what to eat:', row.dataset.food);
        if (nextFood === null || !nextFood.trim()) return;
        await Api.patch(`/diet/${row.dataset.edit}`, { food: nextFood.trim() });
        renderDiet(el, date);
      });
    });
    el.querySelector('#diet-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const food = document.getElementById('d-food').value.trim();
      if (!food) return;
      await Api.post('/diet', {
        entry_date: date,
        meal_label: document.getElementById('d-meal').value,
        food,
        calories: Number(document.getElementById('d-cal').value) || null,
      });
      renderDiet(el, date);
    });
    const copyDietBtn = el.querySelector('#copy-diet');
    if (copyDietBtn) {
      copyDietBtn.addEventListener('click', async () => {
        copyDietBtn.disabled = true;
        copyDietBtn.textContent = 'Copying…';
        const yesterday = DateUtil.addDays(date, -1);
        const prev = await Api.get(`/diet?date=${yesterday}`);
        if (!prev.length) alert("Yesterday didn't have a meal plan to copy.");
        for (const d of prev) {
          await Api.post('/diet', { entry_date: date, meal_label: d.meal_label, food: d.food, calories: d.calories, points: d.points });
        }
        renderDiet(el, date);
      });
    }
  }

  function dietRow(d) {
    return `
      <div class="list-item ${d.eaten ? 'done' : ''}">
        <div class="checkbox ${d.eaten ? 'checked' : ''}" data-toggle="${d.id}" data-done="${d.eaten}">
          ${d.eaten ? checkIcon() : ''}
        </div>
        <div class="grow" data-edit="${d.id}" data-food="${escapeHtml(d.food)}">
          <div class="title">${escapeHtml(d.food)}</div>
          <div class="meta">${escapeHtml(d.meal_label)}${d.calories ? ' · ' + d.calories + ' kcal' : ''}</div>
        </div>
        <span class="pts-chip">+${d.points}</span>
        <button class="icon-x" data-del="${d.id}">✕</button>
      </div>
    `;
  }

  function checkIcon() {
    return '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  return { render };
})();
