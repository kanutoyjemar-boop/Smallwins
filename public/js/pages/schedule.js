const PageSchedule = (() => {
  let renderVersion = 0;

  async function render(el) {
    const version = ++renderVersion;
    const date = AppState.date || DateUtil.today();
    const dates = getWeekDates(date);
    const [weekItems, routines] = await Promise.all([
      Api.get(`/schedule?start=${dates[0]}&end=${dates[6]}`),
      Api.get('/templates?kind=schedule'),
    ]);
    if (version !== renderVersion) return;
    const items = weekItems.filter((item) => String(item.item_date).slice(0, 10) === date);
    const availability = buildAvailabilitySummary(items);

    el.innerHTML = `
      <div class="schedule-week-controls">
        <div class="schedule-week-nav">
          <button class="btn btn-ghost btn-sm" data-week-shift="-7" type="button" aria-label="Previous week">‹</button>
          <strong>${formatWeekRange(dates[0], dates[6])}</strong>
          <button class="btn btn-ghost btn-sm" data-week-shift="7" type="button" aria-label="Next week">›</button>
          <button class="btn btn-ghost btn-sm" data-jump-today type="button">Today</button>
        </div>
        <label class="schedule-date-picker">Choose a date<input id="schedule-date" type="date" value="${date}" aria-label="Choose agenda date"></label>
      </div>
      <div class="schedule-week-strip">
        ${dates.map((d) => {
          const dayItems = countItemsByDate(weekItems, d);
          return `
            <button class="mini-day ${d === date ? 'active' : ''}" data-date="${d}" type="button" aria-label="${DateUtil.label(d)}" aria-pressed="${d === date}">
              <span>${DateUtil.label(d).split(',')[0].slice(0, 3)}</span>
              <strong>${new Date(d + 'T00:00:00').getDate()}</strong>
              <small>${dayItems ? `${dayItems} item${dayItems > 1 ? 's' : ''}` : 'Free'}</small>
            </button>
          `;
        }).join('')}
      </div>

      <div class="panel planner-summary-panel">
        <div class="panel-title">
          <h3>Availability overview</h3>
          <span class="count">${availability.openBlocks} open blocks</span>
        </div>
        <div class="availability-chart">
          ${availability.blocks.map((block) => `
            <div class="availability-row">
              <span>${block.label}</span>
              <div class="availability-bar-track" role="progressbar" aria-label="${block.label}: ${block.occupiedMinutes} minutes booked, ${block.freeMinutes} minutes free" aria-valuemin="0" aria-valuemax="${block.duration}" aria-valuenow="${block.occupiedMinutes}"><div class="availability-bar" style="width:${Math.min(100, (block.occupiedMinutes / block.duration) * 100)}%; background:${block.color};"></div></div>
              <strong>${block.freeMinutes} min free</strong>
            </div>
          `).join('')}
        </div>
        <div class="free-window-note">
          <strong>Most available time</strong>
          <span>${availability.recommended.length ? availability.recommended.join(' · ') : 'No unplanned time remains in these blocks. Consider protecting a recovery block.'}</span>
        </div>
        <p class="meta">Availability uses timed items; completed items use actual duration, while skipped and untimed items do not reserve time.</p>
        ${availability.overlapCount ? `<p class="meta" role="status">${availability.overlapCount} overlapping ${availability.overlapCount === 1 ? 'pair' : 'pairs'} detected. Adjust start times to avoid double-booking.</p>` : ''}
      </div>

      <div class="panel routine-panel">
        <div class="panel-title"><h3>Agenda templates</h3><span class="count">${routines.length} saved</span></div>
        <div class="row routine-actions">
          <button class="btn btn-ghost btn-sm" id="save-schedule-routine" type="button" ${items.length ? '' : 'disabled'}>Save this day's agenda</button>
          ${routines.length ? `<select id="schedule-routine-select" aria-label="Choose an agenda template to preview"><option value="">Preview a template…</option>${routines.map((routine) => `<option value="${routine.id}">${escapeHtml(routine.name)}</option>`).join('')}</select>` : ''}
        </div>
        ${routines.length ? UI.routineWeekPlanner('schedule-week-select', 'apply-schedule-week', routines) : ''}
      </div>

      <div class="panel panel-accent" style="--accent:var(--agenda)">
        <div class="panel-title">
          <h3>Agenda — ${DateUtil.label(date)}</h3>
          <div class="row" style="justify-content:flex-end">
            <span class="count">${items.filter((i) => i.status === 'done').length}/${items.length}</span>
            <button class="btn btn-ghost btn-sm" id="export-agenda" type="button" aria-label="Export the displayed week’s agenda as an iCalendar file">Export week</button>
          </div>
        </div>
        ${!items.length ? `<button class="btn btn-ghost btn-block" id="copy-schedule" type="button" style="margin-bottom:12px">Copy yesterday's agenda</button>` : ''}
        ${items.length ? items.map((item) => itemRow(item, availability.conflictingIds)).join('') : '<p class="empty-state">Your day has some open space. Add anything you want to remember.</p>'}
        <form class="add-form" id="sched-form">
          <input type="text" id="s-title" placeholder="Where should you be / what are you doing?" aria-label="Agenda item title" required maxlength="140">
          <div class="row">
            <input type="text" id="s-location" placeholder="Location (optional)" aria-label="Location (optional)">
            <input type="time" id="s-time" aria-label="Start time">
          </div>
          <div class="row">
            <input type="number" id="s-duration" placeholder="Planned minutes" aria-label="Planned minutes" min="1" value="30">
            <button type="submit" class="btn btn-primary btn-sm" style="flex:0 0 auto">Add</button>
          </div>
        </form>
      </div>
      <div class="panel calendar-import-panel">
        <div class="panel-title"><h3>Import a calendar</h3></div>
        <p class="rating-sub">Preview a one-time iCalendar (.ics) file before adding events. Recurring event series are skipped; times are converted to your device’s local time.</p>
        <label for="calendar-file">iCalendar file (.ics)</label>
        <input id="calendar-file" type="file" accept=".ics,text/calendar">
        <button class="btn btn-ghost btn-sm" id="preview-calendar" type="button" style="margin-top:10px">Preview import</button>
        <div id="calendar-preview" class="calendar-preview" aria-live="polite"></div>
      </div>
    `;

    el.querySelectorAll('[data-date]').forEach((tab) => {
      tab.addEventListener('click', () => {
        AppState.date = tab.dataset.date;
        render(el);
      });
    });
    el.querySelectorAll('[data-week-shift]').forEach((button) => {
      button.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(date, Number(button.dataset.weekShift));
        render(el);
      });
    });
    el.querySelector('[data-jump-today]').addEventListener('click', () => {
      AppState.date = DateUtil.today();
      render(el);
    });
    el.querySelector('#schedule-date').addEventListener('change', (event) => {
      if (!isDateKey(event.currentTarget.value)) return;
      AppState.date = event.currentTarget.value;
      render(el);
    });

    const saveRoutine = el.querySelector('#save-schedule-routine');
    if (saveRoutine) saveRoutine.addEventListener('click', async () => {
      const name = await UI.prompt('Name this agenda template:', 'Focused workday');
      if (!name || !name.trim()) return;
      try {
        await Api.post('/templates', { name: name.trim(), kind: 'schedule', items: items.map((item) => ({ title: item.title, location: item.location, start_time: item.start_time, planned_minutes: item.planned_minutes, points: item.points })) });
        UI.toast('Agenda routine saved.', { kind: 'win' });
        render(el);
      } catch (error) {
        UI.alert(error.message);
      }
    });
    const routineSelect = el.querySelector('#schedule-routine-select');
    if (routineSelect) routineSelect.addEventListener('change', async () => {
      const routine = routines.find((item) => String(item.id) === routineSelect.value);
      if (!routine) return;
      routineSelect.disabled = true;
      try {
        const preview = await UI.confirmRoutineApply(routine, date, items);
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
        render(el);
      } catch (error) {
        UI.alert(error.message);
      } finally {
        routineSelect.disabled = false;
        routineSelect.value = '';
      }
    });
    UI.wireRoutineWeek(el, 'schedule-week-select', 'apply-schedule-week', date, () => render(el));

    el.querySelector('#preview-calendar').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const file = el.querySelector('#calendar-file').files[0];
      const preview = el.querySelector('#calendar-preview');
      if (!file) {
        UI.alert('Choose an .ics file first.');
        return;
      }
      button.disabled = true;
      button.textContent = 'Reading…';
      try {
        const parsed = IcalImport.parse(await file.text());
        if (!parsed.events.length) {
          preview.textContent = `No importable events found. ${parsed.skipped} recurring or unsupported events were skipped.`;
          return;
        }
        const dates = parsed.events.map((item) => item.item_date).sort();
        const existing = await Api.get(`/schedule?start=${dates[0]}&end=${dates[dates.length - 1]}`);
        const keys = new Set(existing.map((item) => `${String(item.item_date).slice(0, 10)}|${item.title}|${item.start_time ? String(item.start_time).slice(0, 5) : ''}`));
        const additions = parsed.events.filter((item) => {
          const key = `${item.item_date}|${item.title}|${item.start_time || ''}`;
          if (keys.has(key)) return false;
          keys.add(key);
          return true;
        });
        preview.innerHTML = `
          <p>${additions.length} new ${additions.length === 1 ? 'event' : 'events'}; ${parsed.events.length - additions.length} already present; ${parsed.skipped} unsupported or recurring skipped.</p>
          <ul>${additions.slice(0, 12).map((item) => `<li><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(DateUtil.label(item.item_date))}${item.start_time ? `, ${escapeHtml(item.start_time)}` : ' (all day)'}</li>`).join('')}</ul>
          ${additions.length > 12 ? `<p>And ${additions.length - 12} more.</p>` : ''}
          ${additions.length ? '<button class="btn btn-primary btn-sm" id="confirm-calendar-import" type="button">Add these events</button>' : ''}
        `;
        preview.querySelector('#confirm-calendar-import')?.addEventListener('click', async (confirmButton) => {
          const importButton = confirmButton.currentTarget;
          if (!navigator.onLine) {
            UI.alert('Calendar imports need a live connection. Reconnect and try again.');
            return;
          }
          if (!await UI.confirm(`Add ${additions.length} calendar ${additions.length === 1 ? 'event' : 'events'} to your Small Wins agenda?`)) return;
          importButton.disabled = true;
          importButton.textContent = 'Importing…';
          try {
            const result = await Api.post('/schedule/ical-import', { events: additions });
            UI.toast(`Added ${result.imported}; skipped ${result.duplicates} duplicate ${result.duplicates === 1 ? 'event' : 'events'}.`, { kind: 'win' });
            render(el);
          } catch (error) {
            UI.alert(error.message);
            importButton.disabled = false;
            importButton.textContent = 'Add these events';
          }
        });
      } catch (error) {
        preview.textContent = error.message;
      } finally {
        button.disabled = false;
        button.textContent = 'Preview import';
      }
    });

    el.querySelector('#export-agenda').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const start = dates[0];
        const end = dates[6];
        await Api.download(
          `/schedule/export.ics?start=${start}&end=${end}`,
          `small-wins-agenda-${start}-to-${end}.ics`
        );
      } catch (error) {
        UI.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });

    el.querySelectorAll('[data-status]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const id = sel.dataset.status;
        const status = sel.value;
        const previousStatus = sel.dataset.currentStatus;
        const planned = Number(sel.dataset.planned);
        const patch = { status };
        if (status === 'done' || status === 'overtime') {
          const minimum = status === 'overtime' ? planned + 1 : 1;
          const suggested = status === 'overtime'
            ? Math.max(minimum, Number(sel.dataset.actual) || 0)
            : Math.min(planned, Number(sel.dataset.actual) || planned);
          const actualInput = await UI.prompt(
            `Actual minutes spent (planned ${planned}; ${status === 'overtime' ? 'must be more than planned' : 'done on time'}):`,
            String(suggested)
          );
          if (actualInput === null) {
            sel.value = previousStatus;
            return;
          }
          const actualMinutes = Number(actualInput);
          if (!Number.isSafeInteger(actualMinutes)
            || actualMinutes < 1
            || (status === 'overtime' && actualMinutes <= planned)
            || (status === 'done' && actualMinutes > planned)) {
            UI.alert(status === 'overtime'
              ? `Enter a whole number greater than ${planned}.`
              : `Enter a whole number from 1 to ${planned} to mark this done on time.`);
            sel.value = previousStatus;
            return;
          }
          patch.actual_minutes = actualMinutes;
        }
        try {
          await Api.patch(`/schedule/${id}`, patch);
        } catch (error) {
          sel.value = previousStatus;
          UI.alert(error.message);
          return;
        }
        render(el);
      });
    });

    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!await UI.confirm('Delete this agenda item?')) return;
        await Api.del(`/schedule/${btn.dataset.del}`);
        render(el);
      });
    });

    el.querySelectorAll('[data-edit]').forEach((row) => {
      row.addEventListener('click', async () => {
        const nextTitle = await UI.prompt('Edit title:', row.dataset.title);
        if (nextTitle === null || !nextTitle.trim()) return;
        const nextLocation = await UI.prompt('Edit location (blank for none):', row.dataset.location || '');
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
        if (!prev.length) UI.toast("Yesterday's agenda was clear, too. Keep this space open or plan something new.");
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

  function countItemsByDate(items, date) {
    return items.filter((item) => String(item.item_date).slice(0, 10) === date).length;
  }

  function getWeekDates(date) {
    const selected = new Date(`${date}T00:00:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const current = new Date(selected);
      current.setDate(current.getDate() + index);
      return `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
    });
  }

  function formatWeekRange(start, end) {
    const first = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    const sameMonth = first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth();
    const firstLabel = first.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(sameMonth ? {} : { year: 'numeric' }),
    });
    const lastLabel = last.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${firstLabel} – ${lastLabel}`;
  }

  function isDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime())
      && `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` === value;
  }

  function buildAvailabilitySummary(items) {
    const blocks = [
      { label: 'Morning', color: 'var(--tasks)', ranges: [[0, 11 * 60]] },
      { label: 'Midday', color: 'var(--agenda)', ranges: [[11 * 60, 14 * 60]] },
      { label: 'Afternoon', color: 'var(--body)', ranges: [[14 * 60, 18 * 60]] },
      { label: 'Evening', color: 'var(--money)', ranges: [[18 * 60, 22 * 60]] },
      { label: 'Night', color: 'var(--needs-work)', ranges: [[22 * 60, 24 * 60]] },
    ];
    const timedItems = items.flatMap((item) => {
      const start = toMinutes(item.start_time);
      if (item.status === 'skipped') return [];
      const actual = Number(item.actual_minutes);
      const duration = ['done', 'overtime'].includes(item.status) && Number.isFinite(actual) && actual > 0
        ? actual
        : Number(item.planned_minutes);
      const end = Math.min(24 * 60, start + duration);
      if (!item.start_time || !Number.isInteger(start) || start < 0 || start >= 24 * 60
        || !Number.isFinite(duration) || duration <= 0 || end <= start) return [];
      return [{ id: item.id, start, end }];
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    const conflictingIds = new Set();
    let overlapCount = 0;
    const active = [];
    for (const item of timedItems) {
      while (active.length && active[0].end <= item.start) active.shift();
      for (const previous of active) {
        conflictingIds.add(previous.id);
        conflictingIds.add(item.id);
        overlapCount += 1;
      }
      active.push(item);
      active.sort((a, b) => a.end - b.end);
    }

    for (const block of blocks) {
      let occupiedMinutes = 0;
      for (const [rangeStart, rangeEnd] of block.ranges) {
        const intervals = timedItems
          .map(({ start, end }) => [Math.max(start, rangeStart), Math.min(end, rangeEnd)])
          .filter(([start, end]) => end > start)
          .sort((a, b) => a[0] - b[0]);
        let mergedStart = null;
        let mergedEnd = null;
        for (const [start, end] of intervals) {
          if (mergedEnd === null || start > mergedEnd) {
            if (mergedStart !== null) occupiedMinutes += mergedEnd - mergedStart;
            mergedStart = start;
            mergedEnd = end;
          } else {
            mergedEnd = Math.max(mergedEnd, end);
          }
        }
        if (mergedStart !== null) occupiedMinutes += mergedEnd - mergedStart;
      }
      block.duration = block.ranges.reduce((total, [start, end]) => total + end - start, 0);
      block.occupiedMinutes = occupiedMinutes;
      block.freeMinutes = block.duration - occupiedMinutes;
    }

    const recommended = blocks
      .filter((block) => block.freeMinutes > 0)
      .sort((a, b) => b.freeMinutes - a.freeMinutes)
      .slice(0, 3)
      .map((block) => `${block.label} (${block.freeMinutes} min free)`);
    return {
      blocks,
      openBlocks: blocks.filter((block) => block.freeMinutes > 0).length,
      overlapCount,
      conflictingIds,
      recommended,
    };
  }

  function toMinutes(time) {
    if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(time)) return NaN;
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  function itemRow(it, conflictingIds = new Set()) {
    const statusColor = { done: 'var(--excellent)', overtime: 'var(--fair)', skipped: 'var(--text-muted)', pending: 'var(--text-muted)' }[it.status];
    const availability = it.start_time ? (it.status === 'done' || it.status === 'overtime' ? 'Booked' : 'Busy block') : 'Open slot';
    return `
      <div class="list-item agenda-item">
        <button type="button" class="grow agenda-edit-button" data-edit="${it.id}" data-title="${escapeHtml(it.title)}" data-location="${escapeHtml(it.location || '')}" aria-label="Edit ${escapeHtml(it.title)}">
          <div class="title">${escapeHtml(it.title)}</div>
          <div class="meta">
            ${it.start_time ? formatTime(it.start_time) + ' · ' : ''}${it.planned_minutes} min planned
            ${['done', 'overtime'].includes(it.status) && it.actual_minutes !== null && it.actual_minutes !== undefined ? ` · ${it.actual_minutes} min actual` : ''}
            ${it.location ? ' · ' + escapeHtml(it.location) : ''}
          </div>
        </button>
        ${conflictingIds.has(it.id) ? '<span class="status-pill" role="status" style="color:var(--needs-work)">Overlap</span>' : ''}
        <span class="status-pill" style="background:${statusColor}22; color:${statusColor};">${availability}</span>
        <select data-status="${it.id}" data-current-status="${it.status}" data-planned="${it.planned_minutes}" data-actual="${it.actual_minutes || ''}" style="width:auto; color:${statusColor}; font-size:12.5px; padding:6px 8px;">
          <option value="pending" ${it.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="done" ${it.status === 'done' ? 'selected' : ''}>Done on time</option>
          <option value="overtime" ${it.status === 'overtime' ? 'selected' : ''}>Ran over</option>
          <option value="skipped" ${it.status === 'skipped' ? 'selected' : ''}>Not today</option>
        </select>
        <button class="icon-x" data-del="${it.id}" aria-label="Delete agenda item: ${escapeHtml(it.title)}">✕</button>
      </div>
    `;
  }

  function formatTime(t) {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  return { render, buildAvailabilitySummary, countItemsByDate, getWeekDates, isDateKey };
})();

if (typeof module !== 'undefined') module.exports = PageSchedule;
