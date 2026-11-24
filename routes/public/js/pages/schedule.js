const PageSchedule = (() => {
  let activeOffset = 0; // 0=today, 1=tomorrow, ...

  async function render(el) {
    const dates = [0, 1, 2, 3, 4, 5, 6].map((n) => DateUtil.addDays(DateUtil.today(), n));
    const date = dates[activeOffset];
    const [items, routines] = await Promise.all([
      Api.get(`/schedule?date=${date}`),
      Api.get('/templates?kind=schedule'),
    ]);
    const availability = buildAvailabilitySummary(items);

    el.innerHTML = `
      <div class="schedule-week-strip">
        ${dates.map((d, i) => {
          const dayItems = (i === activeOffset ? items : []).length;
          return `
            <button class="mini-day ${i === activeOffset ? 'active' : ''}" data-offset="${i}" type="button">
              <span>${DateUtil.label(d).split(',')[0].slice(0, 3)}</span>
              <strong>${new Date(d + 'T00:00:00').getDate()}</strong>
              <small>${dayItems ? `${dayItems} task${dayItems > 1 ? 's' : ''}` : 'Free'}</small>
            </button>
          `;
        }).join('')}
      </div>

      <div class="panel planner-summary-panel">
        <div class="panel-title">
          <h3>Availability overview</h3>
          <span class="count">${availability.availableCount} free windows</span>
        </div>
        <div class="availability-chart">
          ${availability.blocks.map((block) => `
            <div class="availability-row">
              <span>${block.label}</span>
              <div class="availability-bar-track"><div class="availability-bar" style="width:${Math.min(100, (block.value / Math.max(1, availability.maxValue)) * 100)}%; background:${block.color};"></div></div>
              <strong>${block.value}</strong>
            </div>
          `).join('')}
        </div>
        <div class="free-window-note">
          <strong>Best open windows</strong>
          <span>${availability.recommended.length ? availability.recommended.join(' · ') : 'Your day is fully planned. Protect a short recovery block.'}</span>
        </div>
      </div>

      <div class="panel routine-panel">
        <div class="panel-title"><h3>Agenda templates</h3><span class="count">${routines.length} saved</span></div>
        <div class="row routine-actions">
          <button class="btn btn-ghost btn-sm" id="save-schedule-routine" type="button" ${items.length ? '' : 'disabled'}>Save today's agenda</button>
          ${routines.length ? `<select id="schedule-routine-select" aria-label="Choose an agenda template"><option value="">Apply a template…</option>${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${routineManagerHtml(routines)}
      </div>

      <div class="panel panel-accent" style="--accent:var(--agenda)">
        <div class="panel-title">
          <h3>Agenda — ${DateUtil.label(date)}</h3>
          <span class="count">${items.filter((i) => i.status === 'done').length}/${items.length}</span>
        </div>
        ${!items.length ? `<button class="btn btn-ghost btn-block" id="copy-schedule" type="button" style="margin-bottom:12px">Copy yesterday's agenda</button>` : ''}
        ${items.length ? items.map(itemRow).join('') : '<p class="empty-state">Nothing on the agenda.</p>'}
        <form class="add-form" id="sched-form">
          <input type="text" id="s-title" placeholder="Where should you be / what are you doing?" required maxlength="140">
          <div class="row">
            <input type="text" id="s-location" placeholder="Location (optional)">
            <input type="time" id="s-time">
          </div>
          <div class="row">
            <input type="number" id="s-duration" placeholder="Planned minutes" min="1" value="30">
            <button type="submit" class="btn btn-primary btn-sm" style="flex:0 0 auto">Add</button>
          </div>
        </form>
      </div>
    `;

    el.querySelectorAll('[data-offset]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeOffset = Number(tab.dataset.offset);
        render(el);
      });
    });

    wireRoutineManager(el, () => render(el));
    const saveRoutine = el.querySelector('#save-schedule-routine');
    if (saveRoutine) saveRoutine.addEventListener('click', async () => {
      const name = prompt('Name this agenda template:', 'Focused workday');
      if (!name || !name.trim()) return;
      await Api.post('/templates', { name: name.trim(), kind: 'schedule', items: items.map((item) => ({ title: item.title, location: item.location, start_time: item.start_time, planned_minutes: item.planned_minutes, points: item.points })) });
      render(el);
    });
    const routineSelect = el.querySelector('#schedule-routine-select');
    if (routineSelect) routineSelect.addEventListener('change', async () => {
      if (!routineSelect.value) return;
      await Api.post(`/templates/${routineSelect.value}/apply`, { date });
      render(el);
    });

    el.querySelectorAll('[data-status]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.status;
        const status = sel.value;
        const patch = { status };
        if (status === 'done') {
          const planned = Number(sel.dataset.planned);
          patch.actual_minutes = planned;
        }
        await Api.patch(`/schedule/${id}`, patch);
        render(el);
      });
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this agenda item?')) return;
        await Api.del(`/schedule/${btn.dataset.del}`);
        render(el);
      });
    });

    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextTitle = prompt('Edit title:', row.dataset.title);
        if (nextTitle === null || !nextTitle.trim()) return;
        const nextLocation = prompt('Edit location (blank for none):', row.dataset.location || '');
        if (nextLocation === null) return;
        await Api.patch(`/schedule/${row.dataset.edit}`, { title: nextTitle.trim(), location: nextLocation.trim() || null });
        render(el);
      });
    });

    const copyScheduleBtn = el.querySelector('#copy-schedule');
    if (copyScheduleBtn) {
      copyScheduleBtn.addEventListener('click', async () => {
        copyScheduleBtn.disabled = true;
        copyScheduleBtn.textContent = 'Copying…';
        const yesterday = DateUtil.addDays(date, -1);
        const prev = await Api.get(`/schedule?date=${yesterday}`);
        if (!prev.length) alert("Yesterday didn't have an agenda to copy.");
        for (const it of prev) {
          await Api.post('/schedule', {
            item_date: date, title: it.title, location: it.location,
            start_time: it.start_time, planned_minutes: it.planned_minutes, points: it.points,
          });
        }
        render(el);
      });
    }

    el.querySelector('#sched-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('s-title').value.trim();
      if (!title) return;
      await Api.post('/schedule', {
        item_date: date,
        title,
        location: document.getElementById('s-location').value.trim() || null,
        start_time: document.getElementById('s-time').value || null,
        planned_minutes: Number(document.getElementById('s-duration').value) || 30,
      });
      render(el);
    });
  }

  function buildAvailabilitySummary(items) {
    const blocks = [
      { label: 'Morning', key: 'morning', color: 'var(--tasks)', value: 0 },
      { label: 'Midday', key: 'midday', color: 'var(--agenda)', value: 0 },
      { label: 'Afternoon', key: 'afternoon', color: 'var(--body)', value: 0 },
      { label: 'Evening', key: 'evening', color: 'var(--money)', value: 0 },
      { label: 'Night', key: 'night', color: 'var(--needs-work)', value: 0 },
    ];

    for (const item of items) {
      if (!item.start_time || !item.planned_minutes) continue;
      const startMinutes = toMinutes(item.start_time);
      const endMinutes = startMinutes + Number(item.planned_minutes || 0);
      for (const block of blocks) {
        const blockRange = {
          morning: [0, 11 * 60],
          midday: [11 * 60, 14 * 60],
          afternoon: [14 * 60, 18 * 60],
          evening: [18 * 60, 22 * 60],
          night: [22 * 60, 24 * 60],
        }[block.key];
        if (startMinutes < blockRange[1] && endMinutes > blockRange[0]) block.value += 1;
      }
    }

    const maxValue = Math.max(1, ...blocks.map((b) => b.value));
    const availableCount = blocks.filter((b) => b.value === 0).length;
    const recommended = blocks.filter((b) => b.value === 0).map((b) => b.label);
    return { blocks, maxValue, availableCount, recommended: recommended.slice(0, 3) };
  }

  function toMinutes(time) {
    if (!time) return 0;
    const [h, m] = String(time).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function itemRow(it) {
    const statusColor = { done: 'var(--excellent)', overtime: 'var(--fair)', skipped: 'var(--needs-work)', pending: 'var(--text-muted)' }[it.status];
    const availability = it.start_time ? (it.status === 'done' || it.status === 'overtime' ? 'Booked' : 'Busy block') : 'Open slot';
    return `
      <div class="list-item agenda-item">
        <div class="grow" data-edit="${it.id}" data-title="${escapeHtml(it.title)}" data-location="${escapeHtml(it.location || '')}">
          <div class="title">${escapeHtml(it.title)}</div>
          <div class="meta">
            ${it.start_time ? formatTime(it.start_time) + ' · ' : ''}${it.planned_minutes} min planned
            ${it.location ? ' · ' + escapeHtml(it.location) : ''}
          </div>
        </div>
        <span class="status-pill" style="background:${statusColor}22; color:${statusColor};">${availability}</span>
        <select data-status="${it.id}" data-planned="${it.planned_minutes}" style="width:auto; color:${statusColor}; font-size:12.5px; padding:6px 8px;">
          <option value="pending" ${it.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="done" ${it.status === 'done' ? 'selected' : ''}>Done on time</option>
          <option value="overtime" ${it.status === 'overtime' ? 'selected' : ''}>Ran over</option>
          <option value="skipped" ${it.status === 'skipped' ? 'selected' : ''}>Skipped</option>
        </select>
        <button class="icon-x" data-del="${it.id}">✕</button>
      </div>
    `;
  }

  function formatTime(t) {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return { render };
})();
