const PageBody = (() => {
  let activeTab = 'workouts';
  const OTHER_ACTIVITIES = [
    'Push workout', 'Pull workout', 'Legs workout', 'Upper body', 'Lower body',
    'Strength circuit', 'Mobility', 'Stretching', 'Yoga', 'Pilates',
    'Walk', 'Run', 'Jog', 'Tempo run', 'Recovery walk',
    'Swim', 'Cycling', 'Bike ride', 'Gym cardio', 'HIIT',
    'Pickleball', 'Tennis', 'Basketball', 'Football', 'Soccer',
    'Hiking', 'Rowing', 'Martial arts', 'Volleyball', 'Other'
  ];
  const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
  const MEAL_ICON = { Breakfast: '🍳', Lunch: '🥗', Dinner: '🍲', Snack: '🍎' };
  const PROTEIN_GUIDE = [
    { food: 'Chicken breast, skinless (cooked)', protein: 31 },
    { food: 'Chicken thigh, meat only (cooked)', protein: 26 },
    { food: 'Chicken drumstick, meat only (cooked)', protein: 28 },
    { food: 'Chicken liver (cooked)', protein: 25 },
    { food: 'Pork tenderloin (cooked)', protein: 27 },
    { food: 'Pork loin (cooked)', protein: 27 },
    { food: 'Pork kasim / shoulder (cooked)', protein: 25 },
    { food: 'Pork pigue / leg (lean, cooked)', protein: 26 },
    { food: 'Pork belly (cooked)', protein: 10 },
    { food: 'Lean beef sirloin (cooked)', protein: 27 },
    { food: 'Beef brisket (cooked)', protein: 26 },
    { food: 'Bangus / milkfish, meat only (cooked)', protein: 22 },
    { food: 'Tilapia, meat only (cooked)', protein: 26 },
    { food: 'Galunggong / round scad, meat only (cooked)', protein: 24 },
    { food: 'Tuna, meat only (cooked)', protein: 29 },
    { food: 'Whole egg (cooked)', protein: 13 },
    { food: 'Shrimp, peeled (cooked)', protein: 24 },
    { food: 'Tokwa / firm tofu (cooked)', protein: 8 },
    { food: 'Mung beans / monggo (cooked)', protein: 7 },
  ];
  const DISTANCE_ACTIVITIES = new Set([
    'Running (Cardio)', 'Run', 'Jog', 'Tempo run', 'Walk', 'Recovery walk',
    'Swim', 'Cycling', 'Bike ride', 'Hiking', 'Rowing',
  ]);
  const STEP_ACTIVITIES = new Set(['Running (Cardio)', 'Run', 'Jog', 'Tempo run', 'Walk', 'Recovery walk']);
  const actIcon = (a) => /run|jog|tempo/i.test(a) ? '🏃' : /walk|hik/i.test(a) ? '🚶' : /swim/i.test(a) ? '🏊' : /cycl|bike/i.test(a) ? '🚴' : /yoga|pilates|mobil|stretch/i.test(a) ? '🧘' : /pickle|tennis|basket|foot|soccer|volley/i.test(a) ? '🏓' : /martial/i.test(a) ? '🥋' : /hiit|cardio|row/i.test(a) ? '🔥' : '🏋️';
  function heroRing(done, total, big, small, label) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `<div class="panel money-hero body-hero">
      <div class="score-ring animated" data-pct="${pct}" style="--c:var(--body); --p:0"><div class="ring-num"><span class="pct">${pct}</span><span class="pct-sym">%</span></div></div>
      <div><p class="rating-sub" style="margin:0">${label}</p><p class="hero-amount">${big}</p><p class="rating-sub" style="margin:0">${small}</p></div></div>`;
  }

  async function render(el) {
    const date = AppState.date;
    const prevTab = el.dataset.renderedTab === activeTab ? (el.querySelector('#body-tab-content') || {}).innerHTML : '';
    el.innerHTML = `
      <div class="date-nav">
        <button data-nav="-1">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1">›</button>
      </div>
      <div class="tabs">
        <div class="tab ${activeTab === 'workouts' ? 'active' : ''}" data-tab="workouts">Workouts</div>
        <div class="tab ${activeTab === 'diet' ? 'active' : ''}" data-tab="diet">Diet &amp; protein</div>
      </div>
      <div id="body-tab-content">${prevTab || '<div class="skeleton"></div>'}</div>
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
    el.dataset.renderedTab = activeTab;
  }

  // ---------------- Workouts ----------------
  async function renderWorkouts(el, date) {
    let exercises = [];
    const [workouts, routines] = await Promise.all([
      Api.get(`/workouts?date=${date}`),
      Api.get('/templates?kind=workouts'),
    ]);
    const exerciseSuggestions = [
      ...workouts.flatMap((workout) => Array.isArray(workout.exercises)
        ? workout.exercises.map((exercise) => exercise.name)
        : []),
      'Squat',
      'Push-up',
      'Bench press',
    ];
    const done = workouts.filter((w) => w.done).length;
    const totalMinutes = workouts.reduce((sum, w) => sum + Number(w.duration_minutes || 0), 0);
    const totalDistance = workouts.reduce((sum, w) => sum + Number(w.distance_km || 0), 0);
    const totalSteps = workouts.reduce((sum, w) => sum + Number(w.steps || 0), 0);
    const strengthSessions = workouts.filter((w) => /push|pull|legs|strength|upper|lower|gym|circuit|hiit/i.test(w.activity_type)).length;
    const cardioSessions = workouts.filter((w) => /walk|run|jog|tempo|swim|cycling|bike|cardio|hiit|row/i.test(w.activity_type)).length;
    const sportSessions = workouts.filter((w) => /pickleball|tennis|basketball|football|soccer|volleyball|hiking|martial/i.test(w.activity_type)).length;

    el.innerHTML = `
      ${heroRing(done, workouts.length, totalMinutes + ' min', workouts.length ? done + ' of ' + workouts.length + ' sessions done' : 'Rest is part of progress', 'Movement today')}
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
            <span>Distance</span>
            <strong>${totalDistance.toFixed(2)} km</strong>
          </div>
          <div class="body-summary-card">
            <span>Steps</span>
            <strong>${totalSteps.toLocaleString()}</strong>
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
        ${workouts.length ? workouts.map(workoutRow).join('') : '<p class="empty-state">Nothing planned here yet. Rest is part of progress; add movement only if it feels right.</p>'}
        <form class="add-form" id="workout-form">
          <div class="row">
            <select id="w-type" aria-label="Activity type">
              <option value="Gym (Strength)">Gym (Strength)</option>
              <option value="Running (Cardio)">Running (Cardio)</option>
              <optgroup label="Other activities">${OTHER_ACTIVITIES.map((a) => `<option>${escapeHtml(a)}</option>`).join('')}</optgroup>
            </select>
            <input type="number" id="w-duration" placeholder="Minutes (optional)" min="0" step="1" aria-label="Workout duration in minutes, optional">
          </div>
          <div class="row" id="gym-fields" hidden>
            <label class="sr-only" for="w-split">Strength split</label>
            <select id="w-split" aria-label="Strength workout split">
              <option>Push</option><option>Pull</option><option>Legs</option><option>Full body</option><option>Other</option>
            </select>
            <label class="sr-only" for="w-exercise-name">Exercise name</label>
            <input id="w-exercise-name" type="text" list="suggestions-w-exercise-name" placeholder="Exercise (e.g. bench press)" maxlength="80">
          </div>
          <div id="gym-suggestion-wrap" hidden>${UI.suggestions('w-exercise-name', 'Exercise', exerciseSuggestions)}</div>
          <div class="row gym-exercise-inputs" id="gym-fields-details" hidden>
            <label class="sr-only" for="w-exercise-sets">Sets</label>
            <input id="w-exercise-sets" type="number" placeholder="Sets" min="1" max="100" step="1">
            <label class="sr-only" for="w-exercise-reps">Reps</label>
            <input id="w-exercise-reps" type="number" placeholder="Reps" min="1" max="1000" step="1">
            <label class="sr-only" for="w-exercise-weight">Weight in kilograms (optional)</label>
            <input id="w-exercise-weight" type="number" placeholder="Weight (kg)" min="0" max="1000" step="0.5">
          </div>
          <div id="gym-exercises-list" class="gym-exercises-list" aria-live="polite"></div>
          <div class="row" id="gym-add-exercise-wrap" hidden>
            <button type="button" class="btn btn-ghost btn-sm" id="add-gym-exercise">Add exercise</button>
          </div>
          <div class="row" id="running-fields" hidden>
            <label class="sr-only" for="w-distance">Distance in kilometers</label>
            <input type="number" id="w-distance" placeholder="Distance (km)" min="0" max="999999.99" step="0.01">
          </div>
          <div class="row" id="step-fields" hidden>
            <label class="sr-only" for="w-steps">Steps from your watch</label>
            <input type="number" id="w-steps" placeholder="Steps (optional)" min="0" max="1000000" step="1">
          </div>
          <input type="text" id="w-notes" placeholder="Focus or notes (optional)" maxlength="160" aria-label="Workout focus or notes, optional">
          <button type="submit" class="btn btn-primary btn-sm">Add workout</button>
        </form>
      </div>

      <div class="panel routine-panel">
        <div class="panel-title"><h3>Training templates</h3><span class="count">${routines.length} saved</span></div>
        <div class="row routine-actions">
          <button class="btn btn-ghost btn-sm" id="save-workout-routine" type="button" ${workouts.length ? '' : 'disabled'}>Save today's training</button>
          ${routines.length ? `<select id="workout-routine-select" aria-label="Choose a training template to preview"><option value="">Preview a template…</option>${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${routines.length ? UI.routineWeekPlanner('workout-week-select', 'apply-workout-week', routines) : ''}
      </div>
    `;

    el.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('click', async () => {
        await Api.patch(`/workouts/${box.dataset.toggle}`, { done: box.dataset.done !== 'true' });
        renderWorkouts(el, date);
      });
    });
    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!await UI.confirm('Delete this workout?')) return;
        await Api.del(`/workouts/${btn.dataset.del}`);
        renderWorkouts(el, date);
      });
    });
    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextDuration = await UI.prompt('Edit duration (minutes):', row.dataset.duration);
        if (nextDuration === null || isNaN(Number(nextDuration))) return;
        const updates = { duration_minutes: Number(nextDuration) };
        if (row.dataset.activityType === 'Gym (Strength)') {
          const nextSplit = await UI.prompt('Edit strength split (Push, Pull, Legs, Full body, or Other):', row.dataset.split || 'Push');
          if (nextSplit === null) return;
          updates.training_split = nextSplit.trim() || null;
        }
        if (DISTANCE_ACTIVITIES.has(row.dataset.activityType)) {
          const nextDistance = await UI.prompt('Edit distance (km; leave blank to remove):', row.dataset.distance || '');
          if (nextDistance === null || (nextDistance !== '' && (!Number.isFinite(Number(nextDistance)) || Number(nextDistance) < 0))) return;
          updates.distance_km = nextDistance === '' ? null : Number(nextDistance);
        }
        if (STEP_ACTIVITIES.has(row.dataset.activityType)) {
          const nextSteps = await UI.prompt('Edit steps:', row.dataset.steps || '');
          if (nextSteps === null || (nextSteps !== '' && (!Number.isInteger(Number(nextSteps)) || Number(nextSteps) < 0))) return;
          updates.steps = nextSteps === '' ? null : Number(nextSteps);
        }
        const nextNotes = await UI.prompt('Edit notes (blank for none):', row.dataset.notes || '');
        if (nextNotes === null) return;
        await Api.patch(`/workouts/${row.dataset.edit}`, { ...updates, notes: nextNotes.trim() || null });
        renderWorkouts(el, date);
      });
    });
    el.querySelector('#workout-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const activityType = el.querySelector('#w-type').value;
      const distance = el.querySelector('#w-distance').value;
      const steps = el.querySelector('#w-steps').value;
      await Api.post('/workouts', {
        workout_date: date,
        activity_type: activityType,
        duration_minutes: Number(el.querySelector('#w-duration').value) || 0,
        training_split: activityType === 'Gym (Strength)' ? el.querySelector('#w-split').value : null,
        distance_km: DISTANCE_ACTIVITIES.has(activityType) && distance !== '' ? Number(distance) : null,
        steps: STEP_ACTIVITIES.has(activityType) && steps !== '' ? Number(steps) : null,
        exercises: activityType === 'Gym (Strength)' ? exercises : [],
        notes: el.querySelector('#w-notes').value.trim() || null,
      });
      renderWorkouts(el, date);
    });
    const activitySelect = el.querySelector('#w-type');
    const updateActivityFields = () => {
      const isGym = activitySelect.value === 'Gym (Strength)';
      el.querySelector('#gym-fields').hidden = !isGym;
      el.querySelector('#gym-suggestion-wrap').hidden = !isGym;
      el.querySelector('#gym-fields-details').hidden = !isGym;
      el.querySelector('#gym-add-exercise-wrap').hidden = !isGym;
      el.querySelector('#running-fields').hidden = !DISTANCE_ACTIVITIES.has(activitySelect.value);
      el.querySelector('#step-fields').hidden = !STEP_ACTIVITIES.has(activitySelect.value);
    };
    activitySelect.addEventListener('change', updateActivityFields);
    updateActivityFields();
    el.querySelector('#add-gym-exercise').addEventListener('click', () => {
      const nameInput = el.querySelector('#w-exercise-name');
      const setsInput = el.querySelector('#w-exercise-sets');
      const repsInput = el.querySelector('#w-exercise-reps');
      const weightInput = el.querySelector('#w-exercise-weight');
      const name = nameInput.value.trim();
      const sets = Number(setsInput.value);
      const reps = Number(repsInput.value);
      const weight = weightInput.value === '' ? null : Number(weightInput.value);
      if (!name || !Number.isInteger(sets) || sets < 1 || sets > 100 ||
          !Number.isInteger(reps) || reps < 1 || reps > 1000 ||
          (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 1000))) {
        UI.alert('Enter an exercise name, sets, reps, and a valid optional weight.');
        return;
      }
      if (exercises.length >= 30) {
        UI.alert('A workout can include up to 30 exercises.');
        return;
      }
      exercises.push({ name, sets, reps, weight_kg: weight });
      nameInput.value = '';
      setsInput.value = '';
      repsInput.value = '';
      weightInput.value = '';
      el.querySelector('#gym-exercises-list').innerHTML = exercises.map(exerciseRow).join('');
      wireExerciseRemoveButtons(el, exercises);
    });
    const saveRoutine = el.querySelector('#save-workout-routine');
    if (saveRoutine) saveRoutine.addEventListener('click', async () => {
      const name = await UI.prompt('Name this training template:', 'Strength and cardio session');
      if (!name || !name.trim()) return;
      try {
        await Api.post('/templates', { name: name.trim(), kind: 'workouts', items: workouts.map((workout) => ({ activity_type: workout.activity_type, duration_minutes: workout.duration_minutes, notes: workout.notes, training_split: workout.training_split, distance_km: workout.distance_km, steps: workout.steps, exercises: workout.exercises || [], points: workout.points })) });
        UI.toast('Training routine saved.', { kind: 'win' });
        renderWorkouts(el, date);
      } catch (error) {
        UI.alert(error.message);
      }
    });
    const routineSelect = el.querySelector('#workout-routine-select');
    if (routineSelect) routineSelect.addEventListener('change', async () => {
      const routine = routines.find((item) => String(item.id) === routineSelect.value);
      if (!routine) return;
      routineSelect.disabled = true;
      try {
        const preview = await UI.confirmRoutineApply(routine, date, workouts);
        if (!preview) return;
        if (!preview.additions) {
          UI.toast('Those routine items are already planned.');
          return;
        }
        const result = await Api.post(`/templates/${encodeURIComponent(routine.id)}/apply`, { date, items: preview.items });
        if (result && result.queued) {
          UI.toast('Routine saved offline. Its items will appear after your device syncs.', { kind: 'win' });
        } else {
          UI.toast(`Added ${result.count} routine ${result.count === 1 ? 'item' : 'items'}.`, { kind: 'win' });
        }
        renderWorkouts(el, date);
      } catch (error) {
        UI.alert(error.message);
      } finally {
        routineSelect.disabled = false;
        routineSelect.value = '';
      }
    });
    UI.wireRoutineWeek(el, 'workout-week-select', 'apply-workout-week', date, () => renderWorkouts(el, date));
    const copyWorkoutsBtn = el.querySelector('#copy-workouts');
    if (copyWorkoutsBtn) {
      copyWorkoutsBtn.addEventListener('click', async () => {
        copyWorkoutsBtn.disabled = true;
        copyWorkoutsBtn.textContent = 'Copying…';
        const yesterday = DateUtil.addDays(date, -1);
        const prev = await Api.get(`/workouts?date=${yesterday}`);
        if (!prev.length) UI.toast("Yesterday's list was clear, too. Rest is part of progress.");
        for (const w of prev) {
          await Api.post('/workouts', { workout_date: date, activity_type: w.activity_type, duration_minutes: w.duration_minutes, notes: w.notes, training_split: w.training_split, distance_km: w.distance_km, steps: w.steps, exercises: w.exercises || [], points: w.points });
        }
        renderWorkouts(el, date);
      });
    }
  }

  function workoutRow(w) {
    const exerciseSummary = Array.isArray(w.exercises) ? w.exercises.map((exercise) =>
      `${escapeHtml(exercise.name)}: ${exercise.sets}×${exercise.reps}${exercise.weight_kg != null ? ` @ ${exercise.weight_kg} kg` : ''}`
    ).join(' · ') : '';
    const details = [
      w.distance_km != null ? Number(w.distance_km) + ' km' : null,
      w.steps != null ? Number(w.steps).toLocaleString() + ' steps' : null,
      exerciseSummary,
      w.duration_minutes ? w.duration_minutes + ' min' : null,
      w.notes ? escapeHtml(w.notes) : null,
    ].filter(Boolean).join(' · ');
    return `
      <div class="list-item ${w.done ? 'done' : ''}">
        <div class="checkbox ${w.done ? 'checked' : ''}" data-toggle="${w.id}" data-done="${w.done}">
          ${w.done ? checkIcon() : ''}
        </div>
        <div class="grow workout-meta-block" data-edit="${w.id}" data-activity-type="${escapeHtml(w.activity_type)}" data-split="${escapeHtml(w.training_split || '')}" data-distance="${w.distance_km == null ? '' : w.distance_km}" data-steps="${w.steps == null ? '' : w.steps}" data-duration="${w.duration_minutes}" data-notes="${escapeHtml(w.notes || '')}">
          <div class="title">${actIcon(w.activity_type)} ${escapeHtml(w.activity_type)}${w.training_split ? ' · ' + escapeHtml(w.training_split) : ''}</div>
          <div class="meta">${details || 'no details set'}</div>
        </div>
        <span class="pts-chip">+${w.points}</span>
        <button class="icon-x" data-del="${w.id}">✕</button>
      </div>
    `;
  }

  function exerciseRow(exercise, index) {
    return `<div class="gym-exercise-item"><span>${escapeHtml(exercise.name)} · ${exercise.sets} sets × ${exercise.reps} reps${exercise.weight_kg != null ? ` · ${exercise.weight_kg} kg` : ''}</span><button type="button" class="icon-x" data-remove-exercise="${index}" aria-label="Remove ${escapeHtml(exercise.name)}">×</button></div>`;
  }

  function wireExerciseRemoveButtons(el, exercises) {
    el.querySelectorAll('[data-remove-exercise]').forEach((button) => {
      button.addEventListener('click', () => {
        exercises.splice(Number(button.dataset.removeExercise), 1);
        el.querySelector('#gym-exercises-list').innerHTML = exercises.map(exerciseRow).join('');
        wireExerciseRemoveButtons(el, exercises);
      });
    });
  }

  // ---------------- Diet ----------------
  async function renderDiet(el, date) {
    const entries = await Api.get(`/diet?date=${date}`);
    const eaten = entries.filter((d) => d.eaten).length;
    const consumed = entries.filter((d) => d.eaten);
    const kcal = consumed.reduce((sum, d) => sum + Number(d.calories || 0), 0);
    const protein = consumed.reduce((sum, d) => sum + Number(d.protein_grams || 0), 0);
    const foodSuggestions = [
      ...entries.map((entry) => entry.food),
      ...PROTEIN_GUIDE.map((item) => item.food),
      'Rice',
      'Oatmeal',
      'Eggs',
    ];
    el.innerHTML = `
      ${heroRing(eaten, entries.length, protein.toFixed(1) + ' g protein', entries.length ? eaten + ' of ' + entries.length + ' meals logged' : 'Track only what feels useful', 'Fuel today')}
      <div class="panel panel-accent body-summary-panel" style="--accent:var(--body)">
        <div class="panel-title"><h3>Today's intake</h3></div>
        <div class="body-summary-grid">
          <div class="body-summary-card"><span>Protein eaten</span><strong>${protein.toFixed(1)} g</strong></div>
          <div class="body-summary-card"><span>Calories eaten</span><strong>${kcal} kcal</strong></div>
        </div>
      </div>
      <div class="panel panel-accent" style="--accent:var(--body)">
        <div class="panel-title"><h3>Meal plan</h3><span class="count">${eaten}/${entries.length}</span></div>
        ${!entries.length ? `<button class="btn btn-ghost btn-block" id="copy-diet" type="button" style="margin-bottom:12px">Copy yesterday's meal plan</button>` : ''}
        ${entries.length ? entries.map(dietRow).join('') : '<p class="empty-state">Nothing logged here yet. Track a meal only if it’s useful to you.</p>'}
        <form class="add-form" id="diet-form">
          <div class="row">
            <select id="d-meal" aria-label="Meal time">${MEALS.map((m) => `<option>${m}</option>`).join('')}</select>
            <input type="number" id="d-cal" placeholder="kcal (optional)" min="0" style="max-width:120px">
          </div>
          <input type="text" id="d-food" list="suggestions-d-food" placeholder="Meal or food name" aria-label="Meal or food name" required maxlength="160">
          ${UI.suggestions('d-food', 'Food name', foodSuggestions)}
          <div class="row">
            <input type="number" id="d-protein" placeholder="Protein (g)" min="0" max="1000" step="0.1" aria-label="Protein in grams">
            <select id="d-guide" aria-label="Optional food protein estimate">
              <option value="">Food protein guide…</option>
              ${PROTEIN_GUIDE.map((item, index) => `<option value="${index}">${escapeHtml(item.food)} — ${item.protein} g/100g</option>`).join('')}
            </select>
          </div>
          <input type="number" id="d-portion" placeholder="Guide portion weight (g)" min="0" step="1" aria-label="Food portion weight in grams">
          <p class="meta">Guide values are estimates per 100 g of cooked edible portion; trim, bones, and cooking method change the actual amount.</p>
          <button type="submit" class="btn btn-primary btn-sm">Add to plan</button>
        </form>
      </div>
      <details class="panel protein-guide">
        <summary>Protein guide for common market foods</summary>
        <p class="meta">Approximate protein per 100 g cooked edible portion. Weigh meat without bones; raw-weight values differ.</p>
        ${PROTEIN_GUIDE.map((item) => `<div class="protein-guide-row"><span>${escapeHtml(item.food)}</span><strong>${item.protein} g</strong></div>`).join('')}
      </details>
    `;

    el.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('click', async () => {
        await Api.patch(`/diet/${box.dataset.toggle}`, { eaten: box.dataset.done !== 'true' });
        renderDiet(el, date);
      });
    });
    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!await UI.confirm('Delete this meal entry?')) return;
        await Api.del(`/diet/${btn.dataset.del}`);
        renderDiet(el, date);
      });
    });
    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextFood = await UI.prompt('Edit what to eat:', row.dataset.food);
        if (nextFood === null || !nextFood.trim()) return;
        const nextProtein = await UI.prompt('Edit protein in grams (leave blank to remove):', row.dataset.protein || '');
        if (nextProtein === null || (nextProtein !== '' && (!Number.isFinite(Number(nextProtein)) || Number(nextProtein) < 0 || Number(nextProtein) > 1000))) return;
        await Api.patch(`/diet/${row.dataset.edit}`, { food: nextFood.trim(), protein_grams: nextProtein === '' ? null : Number(nextProtein) });
        renderDiet(el, date);
      });
    });
    const guideSelect = el.querySelector('#d-guide');
    const portionInput = el.querySelector('#d-portion');
    const proteinInput = el.querySelector('#d-protein');
    const updateProteinEstimate = () => {
      const item = guideSelect.value === '' ? null : PROTEIN_GUIDE[Number(guideSelect.value)];
      const portion = Number(portionInput.value);
      if (item && portionInput.value !== '' && Number.isFinite(portion)) {
        proteinInput.value = (item.protein * portion / 100).toFixed(1);
        el.querySelector('#d-food').value = item.food;
      }
    };
    guideSelect.addEventListener('change', updateProteinEstimate);
    portionInput.addEventListener('input', updateProteinEstimate);
    el.querySelector('#diet-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const food = document.getElementById('d-food').value.trim();
      if (!food) return;
      await Api.post('/diet', {
        entry_date: date,
        meal_label: document.getElementById('d-meal').value,
        food,
        calories: Number(el.querySelector('#d-cal').value) || null,
        protein_grams: proteinInput.value === '' ? null : Number(proteinInput.value),
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
        if (!prev.length) UI.toast("There was no meal plan to copy from yesterday. You can add something whenever it helps.");
        for (const d of prev) {
          await Api.post('/diet', { entry_date: date, meal_label: d.meal_label, food: d.food, calories: d.calories, protein_grams: d.protein_grams, points: d.points });
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
        <div class="grow" data-edit="${d.id}" data-food="${escapeHtml(d.food)}" data-protein="${d.protein_grams == null ? '' : d.protein_grams}">
          <div class="title">${MEAL_ICON[d.meal_label] || '🍽️'} ${escapeHtml(d.food)}</div>
          <div class="meta">${escapeHtml(d.meal_label)}${d.calories ? ' · ' + d.calories + ' kcal' : ''}${d.protein_grams != null ? ' · ' + Number(d.protein_grams).toFixed(1) + ' g protein' : ''}</div>
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
