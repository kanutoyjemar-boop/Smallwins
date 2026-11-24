const PageTasks = (() => {
  async function render(el) {
    const date = AppState.date;
    const [tasks, routines] = await Promise.all([
      Api.get(`/tasks?date=${date}`),
      Api.get('/templates?kind=tasks'),
    ]);
    el.innerHTML = template(date, tasks, routines);
    wire(el, date, tasks);
  }

  function template(date, tasks, routines) {
    const am = tasks.filter((t) => t.period === 'AM');
    const pm = tasks.filter((t) => t.period === 'PM');
    const done = tasks.filter((t) => t.done).length;
    const total = tasks.length;
    const progress = total ? Math.round((done / total) * 100) : 0;
    const pointsEarned = tasks.filter((t) => t.done).reduce((sum, t) => sum + Number(t.points || 0), 0);
    const pointsPossible = tasks.reduce((sum, t) => sum + Number(t.points || 0), 0);

    return `
      <div class="date-nav">
        <button data-nav="-1">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1">›</button>
      </div>

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
        <div class="summary-footnote">${pointsPossible ? `${pointsEarned} of ${pointsPossible} points earned today` : 'No tasks planned yet'}</div>
      </div>

      <div class="panel routine-panel">
        <div class="panel-title"><h3>Reusable routines</h3><span class="count">${routines.length} saved</span></div>
        <div class="row routine-actions">
          <button class="btn btn-ghost btn-sm" id="save-task-routine" type="button" ${tasks.length ? '' : 'disabled'}>Save today as routine</button>
          ${routines.length ? `<select id="routine-select" aria-label="Choose a task routine"><option value="">Apply a routine…</option>${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${routineManagerHtml(routines)}
      </div>

      ${!tasks.length ? `<button class="btn btn-ghost btn-block" id="copy-yesterday" type="button" style="margin-bottom:14px">Copy yesterday's tasks</button>` : ''}
      ${periodPanel('AM', 'Morning focus', am, 'var(--tasks)')}
      ${periodPanel('PM', 'Afternoon / evening', pm, 'var(--agenda)')}
    `;
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

  function wire(el, date, tasks) {
    el.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(AppState.date, Number(btn.dataset.nav));
        render(el);
      });
    });

    const saveRoutine = el.querySelector('#save-task-routine');
    if (saveRoutine) {
      saveRoutine.addEventListener('click', async () => {
        const name = prompt('Name this routine:', 'Morning and evening tasks');
        if (!name || !name.trim()) return;
        await Api.post('/templates', {
          name: name.trim(),
          kind: 'tasks',
          items: tasks.map((task) => ({ period: task.period, title: task.title, points: task.points })),
        });
        render(el);
      });
    }

    wireRoutineManager(el, () => render(el));
    const routineSelect = el.querySelector('#routine-select');
    if (routineSelect) {
      routineSelect.addEventListener('change', async () => {
        if (!routineSelect.value) return;
        await Api.post(`/templates/${routineSelect.value}/apply`, { date });
        render(el);
      });
    }

    el.querySelectorAll('[data-toggle]').forEach((box) => {
      box.addEventListener('click', async () => {
        const id = box.dataset.toggle;
        const done = box.dataset.done === 'true';
        await Api.patch(`/tasks/${id}`, { done: !done });
        render(el);
      });
    });

    el.querySelectorAll('[data-edit]').forEach((label) => {
      label.addEventListener('click', async () => {
        const next = prompt('Edit task:', label.dataset.current);
        if (next === null || !next.trim() || next.trim() === label.dataset.current) return;
        await Api.patch(`/tasks/${label.dataset.edit}`, { title: next.trim() });
        render(el);
      });
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this task?')) return;
        await Api.del(`/tasks/${btn.dataset.del}`);
        render(el);
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
            alert("Yesterday didn't have any tasks to copy.");
          } else {
            for (const t of prevTasks) {
              await Api.post('/tasks', { task_date: date, period: t.period, title: t.title, points: t.points });
            }
          }
        } finally {
          render(el);
        }
      });
    }

    el.querySelectorAll('[data-add]').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const [titleInput, ptsInput] = form.querySelectorAll('input');
        const title = titleInput.value.trim();
        if (!title) return;
        await Api.post('/tasks', {
          task_date: date,
          period: form.dataset.add,
          title,
          points: Number(ptsInput.value) || 10,
        });
        render(el);
      });
    });
  }

  return { render };
})();
