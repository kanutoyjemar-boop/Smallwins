const PageSettings = (() => {
  async function render(el) {
    const [{ settings, deviceCount, pushConfigured }, totals] = await Promise.all([
      Api.get('/notifications/settings'),
      Api.get('/dashboard/totals'),
    ]);
    el.innerHTML = template(settings, deviceCount, pushConfigured, totals);
    wire(el, settings);
  }

  function timezoneOptions(current) {
    const zones = [
      'Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Asia/Kolkata',
      'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'Australia/Sydney', 'Pacific/Auckland', 'UTC',
    ];
    if (!zones.includes(current)) zones.unshift(current);
    return zones.map((z) => `<option value="${z}" ${z === current ? 'selected' : ''}>${z.replace('_', ' ')}</option>`).join('');
  }

  function template(s, deviceCount, pushConfigured, totals) {
    const isSubscribed = deviceCount > 0;
    const perm = window.Push ? Push.permission() : 'unsupported';

    return `
      <div class="section-label">Streak &amp; badges</div>
      <div class="panel">
        <div class="streak-row">
          <div class="streak-flame status-icon" style="color:var(--great)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c2.3 2.8 3.8 4.8 3.8 7.1A4.1 4.1 0 0 1 7.7 14c0-2.4 1.5-4.4 4.3-7.1Z"/><path d="M10.8 14.8c.7 1.7 2.1 2.7 3.9 3.3"/></svg>
          </div>
          <div>
            <div class="streak-num">${totals.streak}-day streak</div>
            <div class="rating-sub">Best: ${totals.bestStreak} days · ${totals.excellentDays} Excellent days logged</div>
          </div>
        </div>
        ${totals.badges.length ? `
          <div class="badge-grid">
            ${totals.badges.map((b) => `<div class="badge-chip" title="${escapeHtml(b.label)}"><span>${b.icon}</span>${escapeHtml(b.label)}</div>`).join('')}
          </div>
        ` : '<p class="rating-sub" style="margin-top:10px">Keep logging days to start earning badges.</p>'}
      </div>

      <div class="section-label">Milestone history</div>
      <div class="panel">
        ${(totals.milestones || []).length ? (totals.milestones || []).map((m) => `
          <div class="list-item">
            <div class="grow"><div class="title">${escapeHtml(m.label)}</div>
            <div class="meta">Earned ${new Date(m.achieved_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div></div>
          </div>`).join('') : '<p class="empty-state">Milestones you earn will be kept here for good.</p>'}
      </div>

      <div class="section-label">Reminders</div>
      <div class="panel">
        ${!pushConfigured ? `
          <p class="empty-state" style="text-align:left">Push notifications aren't configured on this server yet (needs VAPID keys). Everything else below still saves your preferences for when it's enabled.</p>
        ` : perm === 'unsupported' ? `
          <p class="empty-state" style="text-align:left">This browser doesn't support push notifications. Try Chrome/Edge on Android, or add SelfUp to your iPhone home screen (Safari → Share → Add to Home Screen) first.</p>
        ` : `
          <div class="row" style="align-items:center; justify-content:space-between; margin-bottom:14px">
            <div>
              <div class="title">Notifications on this device</div>
              <div class="meta">${isSubscribed ? `Enabled · ${deviceCount} device${deviceCount === 1 ? '' : 's'} registered` : 'Off — reminders won\u2019t reach your phone'}</div>
            </div>
            <button class="btn ${isSubscribed ? 'btn-ghost' : 'btn-primary'} btn-sm" id="push-toggle" type="button">
              ${isSubscribed ? 'Disable' : 'Enable'}
            </button>
          </div>
          <button class="btn btn-ghost btn-sm btn-block" id="push-test" type="button" ${isSubscribed ? '' : 'disabled'}>Send test notification</button>
          <p class="form-error" id="push-error" style="margin-top:10px"></p>
        `}

        <form id="settings-form" style="margin-top:18px">
          <label>Timezone (used for the reminder times below)
            <select id="tz-input">${timezoneOptions(s.timezone)}</select>
          </label>

          <div class="reminder-row">
            <label class="toggle-row">
              <input type="checkbox" id="smart-enabled" ${s.smart_enabled !== false ? 'checked' : ''}>
              <span class="reminder-switch"><span class="status-icon" style="color:var(--money)"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="7"/></svg></span>Smart reminder timing</span>
            </label>
          </div>

          <div class="reminder-row">
            <label class="toggle-row">
              <input type="checkbox" id="morning-enabled" ${s.morning_enabled ? 'checked' : ''}>
              <span class="reminder-switch"><span class="status-icon" style="color:var(--great)"><svg viewBox="0 0 24 24"><path d="M12 3.5v2.2M12 18.3v2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M3.5 12h2.2M18.3 12h2.2M5.4 18.6l1.6-1.6M17 7l1.6-1.6"/><circle cx="12" cy="12" r="4"/></svg></span>Morning check-in</span>
            </label>
            <input type="time" id="morning-time" value="${s.morning_time}">
          </div>

          <div class="reminder-row">
            <label class="toggle-row">
              <input type="checkbox" id="evening-enabled" ${s.evening_enabled ? 'checked' : ''}>
              <span class="reminder-switch"><span class="status-icon" style="color:var(--agenda)"><svg viewBox="0 0 24 24"><path d="M18 15.8A6.8 6.8 0 0 1 8.2 6a7 7 0 1 0 9.8 9.8Z"/><path d="M12 2.5v2M12 19.5v2M4.5 12h2M17.5 12h2"/></svg></span>Evening check-in</span>
            </label>
            <input type="time" id="evening-time" value="${s.evening_time}">
          </div>

          <div class="reminder-row">
            <label class="toggle-row">
              <input type="checkbox" id="streak-enabled" ${s.streak_enabled ? 'checked' : ''}>
              <span class="reminder-switch"><span class="status-icon" style="color:var(--needs-work)"><svg viewBox="0 0 24 24"><path d="M12 3.5c2.3 2.8 3.8 4.8 3.8 7.1A4.1 4.1 0 0 1 7.7 14c0-2.4 1.5-4.4 4.3-7.1Z"/><path d="M10.8 14.8c.7 1.7 2.1 2.7 3.9 3.3"/></svg></span>Streak-at-risk alert</span>
            </label>
            <input type="time" id="streak-time" value="${s.streak_time}">
          </div>

          <button type="submit" class="btn btn-primary btn-block" style="margin-top:16px">Save reminder settings</button>
          <p class="form-success" id="settings-saved"></p>
        </form>
      </div>

      <div class="section-label">Appearance</div>
      <div class="panel">
        <label class="toggle-row">
          <input type="checkbox" id="theme-toggle" ${document.documentElement.dataset.theme === 'light' ? 'checked' : ''}>
          <span class="reminder-switch"><span class="status-icon" style="color:var(--great)"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.2M12 19.3v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6"/></svg></span>Light mode</span>
        </label>
      </div>

      <div class="section-label">Account</div>
      <div class="panel">
        <form id="profile-form">
          <label>Name<input type="text" id="profile-name" value="${escapeHtml(Api.getUser()?.name || '')}" required maxlength="120"></label>
          <label>Email<input type="email" id="profile-email" value="${escapeHtml(Api.getUser()?.email || '')}" required></label>
          <p class="form-error" id="profile-error"></p>
          <p class="form-success" id="profile-saved"></p>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">Save profile</button>
        </form>
      </div>

      <div class="section-label">Change password</div>
      <div class="panel">
        <form id="password-form">
          <label>Current password<input type="password" id="pw-current" required autocomplete="current-password"></label>
          <label>New password<input type="password" id="pw-new" required minlength="6" autocomplete="new-password"></label>
          <p class="form-error" id="password-error"></p>
          <p class="form-success" id="password-saved"></p>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">Update password</button>
        </form>
      </div>

      <div class="section-label">Your data</div>
      <div class="panel">
        <p class="rating-sub" style="margin:0 0 12px">Download everything you've logged as a single JSON file, for backup or moving elsewhere.</p>
        <div class="row">
          <button class="btn btn-ghost" id="export-data" type="button" style="flex:1">Export my data</button>
          <button class="btn btn-ghost" id="import-data" type="button" style="flex:1">Import backup</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" class="hidden">
        <p class="form-success" id="import-status" aria-live="polite"></p>
        <button class="btn btn-danger-outline btn-block" id="clear-local-data" type="button" style="margin-top:8px">Clear local preferences</button>
      </div>

      <div class="section-label">Sharing privacy</div>
      <div class="panel">
        <label class="toggle-row">
          <input type="checkbox" id="sharing-toggle" ${localStorage.getItem('selfup_sharing_enabled') !== 'false' ? 'checked' : ''}>
          <span class="reminder-switch"><span class="status-icon" style="color:var(--money)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 11 7.6-4.7M8.2 13l7.6 4.7"/></svg></span>Allow achievement sharing</span>
        </label>
        <p class="rating-sub" style="margin:8px 0 0">When disabled, the dashboard keeps your progress private and hides sharing actions.</p>
      </div>

      <div class="panel">
        <button class="btn btn-ghost btn-block" id="settings-logout" type="button">Log out</button>
      </div>
    `;
  }

  function wire(el, settings) {
    const pushToggle = el.querySelector('#push-toggle');
    if (pushToggle) {
      pushToggle.addEventListener('click', async () => {
        const errEl = el.querySelector('#push-error');
        errEl.textContent = '';
        pushToggle.disabled = true;
        try {
          if (pushToggle.textContent.trim() === 'Enable') {
            await Push.enable();
          } else {
            await Push.disable();
          }
          render(el);
        } catch (e) {
          errEl.textContent = e.message;
          pushToggle.disabled = false;
        }
      });
    }

    const testBtn = el.querySelector('#push-test');
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const errEl = el.querySelector('#push-error');
        errEl.textContent = '';
        testBtn.disabled = true;
        testBtn.textContent = 'Sending…';
        try {
          await Api.post('/notifications/test', {});
          testBtn.textContent = 'Sent — check your phone';
        } catch (e) {
          errEl.textContent = e.message;
          testBtn.textContent = 'Send test notification';
        } finally {
          testBtn.disabled = false;
        }
      });
    }

    el.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const savedEl = el.querySelector('#settings-saved');
      try {
        const updated = await Api.put('/notifications/settings', {
          timezone: el.querySelector('#tz-input').value,
          smart_enabled: el.querySelector('#smart-enabled').checked,
          morning_enabled: el.querySelector('#morning-enabled').checked,
          morning_time: el.querySelector('#morning-time').value,
          evening_enabled: el.querySelector('#evening-enabled').checked,
          evening_time: el.querySelector('#evening-time').value,
          streak_enabled: el.querySelector('#streak-enabled').checked,
          streak_time: el.querySelector('#streak-time').value,
        });
        savedEl.textContent = 'Saved.';
        setTimeout(() => { savedEl.textContent = ''; }, 2500);
      } catch (err) {
        savedEl.textContent = err.message;
      }
    });

    el.querySelector('#settings-logout').addEventListener('click', () => {
      document.getElementById('logout-btn').click();
    });

    el.querySelector('#theme-toggle').addEventListener('change', (e) => {
      const theme = e.target.checked ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      localStorage.setItem('selfup_theme', theme);
    });

    el.querySelector('#sharing-toggle').addEventListener('change', (e) => {
      localStorage.setItem('selfup_sharing_enabled', String(e.target.checked));
    });

    el.querySelector('#clear-local-data').addEventListener('click', () => {
      if (!confirm('Clear local theme, sharing, and planning preferences? Your server data will remain safe.')) return;
      ['selfup_theme', 'selfup_sharing_enabled', 'selfup_next_week_focus'].forEach((key) => localStorage.removeItem(key));
      alert('Local preferences cleared.');
      render(el);
    });

    el.querySelector('#profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = el.querySelector('#profile-error');
      const savedEl = el.querySelector('#profile-saved');
      errEl.textContent = '';
      savedEl.textContent = '';
      try {
        const updated = await Api.patch('/auth/me', {
          name: el.querySelector('#profile-name').value.trim(),
          email: el.querySelector('#profile-email').value.trim(),
        });
        const user = Api.getUser();
        Api.setSession(Api.getToken(), { ...user, name: updated.name, email: updated.email });
        savedEl.textContent = 'Saved.';
        setTimeout(() => { savedEl.textContent = ''; }, 2500);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    el.querySelector('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = el.querySelector('#password-error');
      const savedEl = el.querySelector('#password-saved');
      errEl.textContent = '';
      savedEl.textContent = '';
      try {
        await Api.post('/auth/change-password', {
          currentPassword: el.querySelector('#pw-current').value,
          newPassword: el.querySelector('#pw-new').value,
        });
        el.querySelector('#password-form').reset();
        savedEl.textContent = 'Password updated.';
        setTimeout(() => { savedEl.textContent = ''; }, 2500);
      } catch (err) {
        errEl.textContent = err.message;
      }
    });

    el.querySelector('#export-data').addEventListener('click', async () => {
      const btn = el.querySelector('#export-data');
      btn.disabled = true;
      btn.textContent = 'Preparing…';
      try {
        const data = await Api.get('/export');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `selfup-export-${DateUtil.today()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Export my data';
      }
    });

    el.querySelector('#import-data').addEventListener('click', () => el.querySelector('#import-file').click());
    el.querySelector('#import-file').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const status = el.querySelector('#import-status');
      try {
        const data = JSON.parse(await file.text());
        if (!confirm('Merge this backup into your current account? Existing entries will remain.')) return;
        const result = await Api.post('/export/import', data);
        status.textContent = result.message || 'Backup imported successfully.';
      } catch (error) {
        status.textContent = error.message || 'Import failed.';
      } finally {
        event.target.value = '';
      }
    });
  }

  return { render };
})();
