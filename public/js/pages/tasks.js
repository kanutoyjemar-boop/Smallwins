const PageTasks = (() => {
  let renderVersion = 0;

  async function render(el) {
    if (!el.querySelector('.tasks-page')) {
      el.innerHTML = `
        <div class="tasks-page">
          <div class="date-nav">
            <button data-nav="-1" type="button" aria-label="Previous day">‹</button>
            <div class="date-label"></div>
            <button data-nav="1" type="button" aria-label="Next day">›</button>
            <button class="btn btn-ghost btn-sm" data-jump-today type="button">Today</button>
            <label class="sr-only" for="task-date">Choose task date</label>
            <input id="task-date" type="date" aria-label="Choose task date">
          </div>
          <div class="tasks-date-content"></div>
        </div>
      `;
      el.querySelectorAll('[data-nav]').forEach((button) => {
        button.addEventListener('click', () => {
          AppState.date = DateUtil.addDays(AppState.date, Number(button.dataset.nav));
          render(el);
        });
      });
      el.querySelector('[data-jump-today]').addEventListener('click', () => {
        AppState.date = DateUtil.today();
        render(el);
      });
      el.querySelector('#task-date').addEventListener('change', (event) => {
        if (!event.currentTarget.value) return;
        AppState.date = event.currentTarget.value;
        render(el);
      });
    }

    const date = AppState.date;
    const version = ++renderVersion;
    // Tasks first: the server generates any due recurring tasks while answering this call.
    const tasks = await Api.get(`/tasks?date=${date}`);
    const [routines, recurring] = await Promise.all([
      Api.get('/templates?kind=tasks'),
      Api.get('/recurring').catch(() => []),
    ]);
    if (version !== renderVersion) return;
    const dateNav = el.querySelector('.date-nav');
    dateNav.querySelector('.date-label').textContent = DateUtil.label(date);
    dateNav.querySelector('#task-date').value = date;
    const content = el.querySelector('.tasks-date-content');
    content.innerHTML = template(date, tasks, routines, recurring);
    content.classList.remove('date-content-enter');
    requestAnimationFrame(() => content.classList.add('date-content-enter'));
    wire(content, date, tasks, el);
  }

  function template(date, tasks, routines, recurring = []) {
    const am = tasks.filter((t) => t.period === 'AM');
    const pm = tasks.filter((t) => t.period === 'PM');
    const done = tasks.filter((t) => t.done).length;
    const total = tasks.length;
    const progress = total ? Math.round((done / total) * 100) : 0;
    const pointsEarned = tasks.filter((t) => t.done).reduce((sum, t) => sum + Number(t.points || 0), 0);
    const pointsPossible = tasks.reduce((sum, t) => sum + Number(t.points || 0), 0);

    return `
      <div class="panel task-summary-panel">
        <div class="panel-title">
          <h3>Task momentum</h3>
          <span class="count">${done}/${total} done</span>
        </div>
        <div class="task-summary-grid">
          <div class="summary-card">
            <span>Completed</span>
            <strong>${done}</strong>
          </div>
          <div class="summary-card">
            <span>Open</span>
            <strong>${Math.max(0, total - done)}</strong>
          </div>
          <div class="summary-card">
            <span>Points</span>
            <strong>+${pointsEarned}</strong>
          </div>
          <div class="summary-card">
            <span>Rate</span>
            <strong>${progress}%</strong>
          </div>
        </div>
        <div class="task-progress">
          <div class="task-progress-bar" style="width:${progress}%"></div>
        </div>
        <div class="summary-footnote">${pointsPossible ? `${pointsEarned} of ${pointsPossible} points earned for ${DateUtil.label(date)}` : `No tasks planned for ${DateUtil.label(date)}`}</div>
      </div>

      <div class="panel routine-panel">
        <div class="panel-title"><h3>Reusable routines</h3><span class="count">${routines.length} saved</span></div>
        <div class="row routine-actions">
          <button class="btn btn-ghost btn-sm" id="save-task-routine" type="button" ${tasks.length ? '' : 'disabled'}>Save this day as routine</button>
          ${routines.length ? `<select id="routine-select" aria-label="Choose a task routine"><option value="">Apply a routine…</option>${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${routines.length ? UI.routineWeekPlanner('routine-week-select', 'apply-task-week', routines) : ''}
      </div>

      ${recurringPanel(recurring)}
      ${!tasks.length ? `<button class="btn btn-ghost btn-block" id="copy-yesterday" type="button" style="margin-bottom:14px">Copy yesterday's tasks</button>` : ''}
      ${periodPanel('AM', 'Morning focus', am, 'var(--tasks)')}
      ${periodPanel('PM', 'Afternoon / evening', pm, 'var(--agenda)')}
    `;
  }

  const REPEATS = { daily: [0, 1, 2, 3, 4, 5, 6], weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] };
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function repeatLabel(days) {
    const k = Object.keys(REPEATS).find((n) => REPEATS[n].length === days.length && REPEATS[n].every((d) => days.includes(d)));
    return k === 'daily' ? 'Every day' : k === 'weekdays' ? 'Weekdays' : k === 'weekends' ? 'Weekends' : days.map((d) => DAY[d]).join(', ');
  }
  function recurringPanel(list) {
    if (!list.length) return '';
    return `<div class="panel routine-panel"><div class="panel-title"><h3>Repeating tasks</h3><span class="count">${list.length} active</span></div>
      ${list.map((r) => `<div class="list-item"><span class="repeat-ico" aria-hidden="true">↻</span><div class="grow"><div class="title">${escapeHtml(r.title)}</div><div class="meta">${repeatLabel(r.weekdays)} · ${r.period === 'AM' ? 'Morning' : 'Afternoon / evening'}</div></div><span class="pts-chip">+${r.points}</span><button class="icon-x" data-del-recurring="${r.id}" aria-label="Stop repeating">✕</button></div>`).join('')}</div>`;
  }

  function periodPanel(period, title, list, accent) {
    const done = list.filter((t) => t.done).length;
    const percent = list.length ? Math.round((done / list.length) * 100) : 0;
    return `
      <div class="panel panel-accent" style="--accent:${accent}">
        <div class="panel-title">
          <h3>${title}</h3>
          <span class="count">${done}/${list.length}</span>
        </div>
        <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${percent}%; background:${accent}"></div></div>
        ${list.length ? list.map((t) => taskRow(t)).join('') : '<p class="empty-state">No tasks yet.</p>'}
        <form class="add-form" data-add="${period}">
          <div class="row">
            <input type="text" placeholder="Add a ${period === 'AM' ? 'morning' : 'afternoon'} task…" required maxlength="140">
            <input type="number" placeholder="pts" value="10" min="1" max="100" style="max-width:64px">
          </div>
          <select class="repeat-select" aria-label="Repeat"><option value="">Doesn’t repeat</option><option value="daily">↻ Every day</option><option value="weekdays">↻ Weekdays</option><option value="weekends">↻ Weekends</option></select>
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
      </div>
    `;
  }

  function taskRow(t) {
    return `
      <div class="list-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <div class="checkbox ${t.done ? 'checked' : ''}" data-toggle="${t.id}" data-done="${t.done}">
          ${t.done ? '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
        </div>
        <div class="grow task-text-block">
          <div class="title" data-edit="${t.id}" data-field="title" data-current="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>
          <div class="meta task-meta">${t.done ? 'Finished' : 'Still on the list'} · ${t.period} block</div>
        </div>
        <span class="pts-chip">+${t.points}</span>
        <button class="icon-x" data-del="${t.id}">✕</button>
      </div>
    `;
  }

  function wire(el, date, tasks, root) {
    const saveRoutine = el.querySelector('#save-task-routine');
    if (saveRoutine) {
      saveRoutine.addEventListener('click', async () => {
        const name = await UI.prompt('Name this routine:', 'Morning and evening tasks');
        if (!name || !name.trim()) return;
        await Api.post('/templates', {
          name: name.trim(),
          kind: 'tasks',
          items: tasks.map((task) => ({ period: task.period, title: task.title, points: task.points })),
        });
        render(root);
      });
    }

    const routineSelect = el.querySelector('#routine-select');
    if (routineSelect) {
      routineSelect.addEventListener('change', async () => {
        if (!routineSelect.value) return;
        await Api.post(`/templates/${routineSelect.value}/apply`, { date });
        render(root);
      });
    }
    UI.wireRoutineWeek(el, 'routine-week-select', 'apply-task-week', date, () => render(root));

    el.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('click', async () => {
        const id = box.dataset.toggle;
        const done = box.dataset.done === 'true';
        await Api.patch(`/tasks/${id}`, { done: !done });
        render(root);
      });
    });

    el.querySelectorAll('[data-edit]').forEach((label) => {
      label.addEventListener('click', async () => {
        const next = await UI.prompt('Edit task:', label.dataset.current);
        if (next === null || !next.trim() || next.trim() === label.dataset.current) return;
        await Api.patch(`/tasks/${label.dataset.edit}`, { title: next.trim() });
        render(root);
      });
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const gone = tasks.find((t) => String(t.id) === String(btn.dataset.del));
        await Api.del(`/tasks/${btn.dataset.del}`);
        render(root);
        if (gone) UI.toast('Task deleted', { undo: async () => { await Api.post('/tasks', { task_date: gone.task_date ? String(gone.task_date).slice(0, 10) : date, period: gone.period, title: gone.title, points: gone.points }); render(root); } });
      });
    });

    el.querySelectorAll('[data-del-recurring]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!await UI.confirm('Stop repeating this task? Tasks already created stay.')) return;
        await Api.del(`/recurring/${btn.dataset.delRecurring}`);
        render(root);
      });
    });

    const copyBtn = el.querySelector('#copy-yesterday');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        copyBtn.disabled = true;
        copyBtn.textContent = 'Copying…';
        try {
          const yesterday = DateUtil.addDays(date, -1);
          const prevTasks = await Api.get(`/tasks?date=${yesterday}`);
          if (!prevTasks.length) {
            UI.alert("Yesterday didn't have any tasks to copy.");
          } else {
            for (const t of prevTasks) {
              await Api.post('/tasks', { task_date: date, period: t.period, title: t.title, points: t.points });
            }
          }
        } finally {
          render(root);
        }
      });
    }

    el.querySelectorAll('[data-add]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const [titleInput, ptsInput] = form.querySelectorAll('input');
        const title = titleInput.value.trim();
        if (!title) return;
        const repeat = form.querySelector('.repeat-select').value;
        const body = { period: form.dataset.add, title, points: Number(ptsInput.value) || 10 };
        if (repeat) {
          await Api.post('/recurring', { ...body, weekdays: REPEATS[repeat], start_date: date });
          UI.toast(`Repeats ${repeatLabel(REPEATS[repeat]).toLowerCase()}`, { kind: 'win' });
        } else {
          await Api.post('/tasks', { ...body, task_date: date });
        }
        render(root);
      });
    });
  }

  return { render };
})();
