const PageSettings = (() => {
  async function render(el) {
    const [{ settings, deviceCount, pushConfigured }, totals, scoring, profile, sampleData] = await Promise.all([
      Api.get('/notifications/settings'),
      Api.get('/dashboard/totals'),
      Api.get('/preferences/scoring'),
      Api.get('/auth/me'),
      Api.get('/sample-data'),
    ]);
    const session = Api.getUser();
    Api.setSession(Api.getToken(), { ...session, ...profile });
    el.innerHTML = template(settings, deviceCount, pushConfigured, totals, scoring, profile, sampleData);
    wire(el, settings);
  }

  function formatMilestoneDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

  function template(s, deviceCount, pushConfigured, totals, scoring, profile, sampleData) {
    const isSubscribed = deviceCount > 0;
    const perm = typeof Push !== 'undefined' ? Push.permission() : 'unsupported';
    const scoringAreas = [
      ['tasks', 'Tasks'],
      ['workouts', 'Workouts'],
      ['diet', 'Diet'],
      ['schedule', 'Agenda'],
      ['money', 'Money'],
    ];
    const weightOptions = (selected) => [
      [0, 'Exclude'],
      [1, 'Normal'],
      [2, 'Important'],
      [3, 'Top priority'],
    ].map(([value, label]) => `<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${label}</option>`).join('');

    return `
      <div class="section-label">Install on your phone</div>
      <div class="panel">
        <p class="meta">Choose the version that matches where you want your data stored.</p>
        <p><strong>Hosted account:</strong> use the hosted HTTPS address on your devices. Previously opened data is saved on each device for offline viewing; supported changes sync to the hosted account when you reconnect. Devices do not share unsynced offline changes.</p>
        <p><strong>Local Windows app:</strong> uses a separate database on this computer and works without internet while the app and database are running. It does not automatically sync with your hosted account or phone.</p>
        <p><strong>Android:</strong> open this page in Chrome, tap <strong>⋮</strong>, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
        <p><strong>iPhone or iPad:</strong> open this page in Safari, tap <strong>Share</strong>, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</p>
        <p class="meta">Sign in and open the pages you need while online to save their data on this device. Simple item deletes can queue too; imports, bill payments, savings actions, and account actions need a connection.</p>
        <p class="rating-sub" id="settings-last-sync">${Api.lastSyncTime()
          ? `Last successful account connection on this device: ${escapeHtml(new Date(Api.lastSyncTime()).toLocaleString())}.`
          : 'This device has not yet connected to your hosted account.'}</p>
      </div>

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
        ${(totals.milestones || []).length ? `
          <div class="badge-grid">
            ${totals.milestones.map((m) => `<div class="badge-chip" title="Earned ${escapeHtml(formatMilestoneDate(m.achieved_at))}"><span>${m.icon}</span>${escapeHtml(m.label)}</div>`).join('')}
          </div>
        ` : '<p class="rating-sub" style="margin-top:10px">Keep logging days to start earning badges.</p>'}
      </div>

      ${(totals.milestones || []).length ? `
        <div class="section-label">Milestone history</div>
        <div class="panel">
          ${totals.milestones.map((m) => `
            <div class="list-item">
              <span class="milestone-icon" aria-hidden="true">${m.icon}</span>
              <div class="grow">
                <div class="title">${escapeHtml(m.label)}</div>
                <div class="meta">Earned ${escapeHtml(formatMilestoneDate(m.achieved_at))}</div>
              </div>
            </div>`).join('')}
        </div>
      ` : ''}

      <div class="section-label">Reminders</div>
      <div class="panel">
        ${!pushConfigured ? `
          <p class="empty-state" style="text-align:left">Push notifications aren't configured on this server yet (needs VAPID keys). Everything else below still saves your preferences for when it's enabled.</p>
        ` : perm === 'unsupported' ? `
          <p class="empty-state" style="text-align:left">This browser doesn't support push notifications. Try Chrome/Edge on Android, or add Small Wins to your iPhone home screen (Safari → Share → Add to Home Screen) first.</p>
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

          <div class="section-label">Money alerts (optional)</div>
          <p class="meta">These alerts use your timezone and require a device with notifications enabled. Low-balance alerts also require a monthly allowance; they send at most once per month.</p>
          <div class="reminder-row">
            <label class="toggle-row">
              <input type="checkbox" id="bill-due-enabled" ${s.bill_due_enabled ? 'checked' : ''}>
              <span class="reminder-switch">Bill due reminders</span>
            </label>
            <select id="bill-due-days-before" aria-label="Bill reminder lead time">
              ${[0, 1, 2, 3, 4, 5, 6, 7].map((days) => `<option value="${days}" ${Number(s.bill_due_days_before) === days ? 'selected' : ''}>${days === 0 ? 'On due date' : `${days} day${days === 1 ? '' : 's'} before`}</option>`).join('')}
            </select>
            <input type="time" id="bill-due-time" value="${s.bill_due_time || '08:00'}" aria-label="Bill reminder time">
          </div>
          <div class="reminder-row">
            <label class="toggle-row">
              <input type="checkbox" id="low-balance-enabled" ${s.low_balance_enabled ? 'checked' : ''}>
              <span class="reminder-switch">Low-balance alert</span>
            </label>
            <input type="number" id="low-balance-threshold" min="0" max="9999999999.99" step="0.01" value="${s.low_balance_threshold ?? 0}" aria-label="Low-balance threshold">
            <input type="time" id="low-balance-time" value="${s.low_balance_time || '20:00'}" aria-label="Low-balance alert time">
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
          <label>Name<input type="text" id="profile-name" value="${escapeHtml(profile.name || '')}" required maxlength="120"></label>
          <label>Username<input type="text" id="profile-username" value="${escapeHtml(profile.username || '')}" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username" aria-describedby="profile-username-help"></label>
          <p class="meta" id="profile-username-help">Your public identity on shared progress cards. Use 3–24 letters, numbers, or underscores. Your email stays private.</p>
          <label>Email<input type="email" id="profile-email" value="${escapeHtml(profile.email || '')}" required></label>
          <p class="form-error" id="profile-error"></p>
          <p class="form-success" id="profile-saved"></p>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">Save profile</button>
        </form>
      </div>

      <div class="section-label">Personal scoring</div>
      <div class="panel">
        <p class="rating-sub" style="margin:0 0 12px">Choose how much each area contributes to your daily score. Your choices recalculate past scores and streaks; milestones already earned stay in your history. At least one area must be included.</p>
        <form id="scoring-form">
          ${scoringAreas.map(([key, label]) => `
            <label class="scoring-preference-row">${label}
              <select id="score-weight-${key}" aria-label="${label} score priority">${weightOptions(scoring[key])}</select>
            </label>`).join('')}
          <p class="form-error" id="scoring-error"></p>
          <p class="form-success" id="scoring-saved" aria-live="polite"></p>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:8px">Save scoring priorities</button>
        </form>
      </div>

      <div class="section-label">Change password</div>
      <div class="panel">
        <form id="password-form">
          <label>Current password<input type="password" id="pw-current" required autocomplete="current-password"></label>
          <label>New password<input type="password" id="pw-new" required minlength="12" autocomplete="new-password"></label>
          <p class="form-error" id="password-error"></p>
          <p class="form-success" id="password-saved"></p>
          <button type="submit" class="btn btn-primary btn-block" style="margin-top:6px">Update password</button>
        </form>
      </div>

      <div class="section-label">Your data</div>
      <div class="panel">
        <div class="data-location" id="data-location">
          <strong>${['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname) ? 'Stored on this computer' : 'Stored in your online account'}</strong>
          <p class="rating-sub" style="margin:4px 0 12px">${['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname)
            ? 'This is the local Windows app. Entries live in the database on this computer and work with no internet. They do not sync with a hosted account or your phone. To move data between them, export a backup from one and import it into the other.'
            : 'This is the hosted app. Your account is stored online, and recent pages are also kept on this device so you can view them offline. Changes made offline wait on this device until you reconnect. It does not sync with a local Windows app; use export and import to move data between them.'}</p>
        </div>
        <p class="rating-sub" style="margin:0 0 12px">Your account records are stored in this app’s PostgreSQL database; your browser also stores your sign-in session and local display/sharing preferences. Export a JSON copy for backup or moving elsewhere. Account deletion removes your account and its associated records from the database; your hosting provider may retain backups according to its own retention policy.</p>
        <p class="rating-sub"><a href="/privacy.html" target="_blank" rel="noopener">Read the privacy notice</a></p>
        <div class="row">
          <button class="btn btn-ghost" id="export-data" type="button" style="flex:1">Export my data</button>
          <button class="btn btn-ghost" id="import-data" type="button" style="flex:1">Import backup</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" class="hidden">
        <p class="form-success" id="import-status" aria-live="polite"></p>
        <div class="section-label">Try sample entries</div>
        <p class="rating-sub">Add example tasks, movement, a meal, an agenda item, a goal, and an expense to explore the app. They affect your dashboard and totals until removed. Removing them deletes only the entries created by this feature.</p>
        <div class="row">
          <button class="btn btn-ghost" id="add-sample-data" type="button" ${sampleData.active || !navigator.onLine ? 'disabled' : ''} style="flex:1">Add sample entries</button>
          <button class="btn btn-ghost" id="remove-sample-data" type="button" ${sampleData.active && navigator.onLine ? '' : 'disabled'} style="flex:1">Remove sample entries</button>
        </div>
        <p class="form-success" id="sample-data-status" aria-live="polite">${sampleData.active
          ? `${sampleData.record_count} example entries are currently loaded.`
          : navigator.onLine ? 'No sample entries are loaded.' : 'Connect to manage sample entries.'}</p>
        <button class="btn btn-danger-outline btn-block" id="clear-local-data" type="button" style="margin-top:8px">Clear local preferences</button>
        <div class="account-delete">
          <div class="section-label">Delete account</div>
          <p class="rating-sub">This permanently deletes your account and logged data. Export a backup first if you may want it later.</p>
          <label>Current password<input type="password" id="delete-password" autocomplete="current-password"></label>
          <label>Type DELETE to confirm<input type="text" id="delete-confirmation" autocomplete="off"></label>
          <p class="form-error" id="delete-error"></p>
          <button class="btn btn-danger-outline btn-block" id="delete-account" type="button">Permanently delete my account</button>
        </div>
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
          bill_due_enabled: el.querySelector('#bill-due-enabled').checked,
          bill_due_days_before: Number(el.querySelector('#bill-due-days-before').value),
          bill_due_time: el.querySelector('#bill-due-time').value,
          low_balance_enabled: el.querySelector('#low-balance-enabled').checked,
          low_balance_threshold: Number(el.querySelector('#low-balance-threshold').value),
          low_balance_time: el.querySelector('#low-balance-time').value,
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

    el.querySelector('#clear-local-data').addEventListener('click', async () => {
      if (!await UI.confirm('Clear local theme, sharing, and planning preferences? Your server data will remain safe.')) return;
      ['selfup_theme', 'selfup_sharing_enabled', 'selfup_next_week_focus'].forEach((key) => localStorage.removeItem(key));
      UI.alert('Local preferences cleared.');
      render(el);
    });

    el.querySelector('#scoring-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = el.querySelector('#scoring-error');
      const saved = el.querySelector('#scoring-saved');
      error.textContent = '';
      saved.textContent = '';
      const preferences = Object.fromEntries(['tasks', 'workouts', 'diet', 'schedule', 'money']
        .map((key) => [key, Number(el.querySelector(`#score-weight-${key}`).value)]));
      try {
        await Api.put('/preferences/scoring', preferences);
        saved.textContent = 'Scoring priorities saved.';
        refreshXp();
        setTimeout(() => { if (saved.isConnected) saved.textContent = ''; }, 2500);
      } catch (err) {
        error.textContent = err.message;
      }
    });

    el.querySelector('#delete-account').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const password = el.querySelector('#delete-password').value;
      const confirmation = el.querySelector('#delete-confirmation').value.trim();
      const error = el.querySelector('#delete-error');
      error.textContent = '';
      if (!password || confirmation !== 'DELETE') {
        error.textContent = 'Enter your current password and type DELETE exactly.';
        return;
      }
      if (!await UI.confirm('This permanently deletes your account and all associated data. Continue?')) return;
      button.disabled = true;
      try {
        await Api.post('/auth/delete-account', { password, confirmation });
        ['selfup_sharing_enabled', 'selfup_onboarded', `selfup_onboarded_${(Api.getUser() || {}).id}`]
          .forEach((key) => localStorage.removeItem(key));
        const briefKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .filter((key) => key && key.startsWith('selfup_daily_brief_'));
        briefKeys.forEach((key) => localStorage.removeItem(key));
        Api.clearSession();
        document.getElementById('logout-btn').click();
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
      }
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
          username: el.querySelector('#profile-username').value.trim().toLowerCase(),
          email: el.querySelector('#profile-email').value.trim(),
        });
        const user = Api.getUser();
        Api.setSession(Api.getToken(), { ...user, ...updated });
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
        const session = await Api.post('/auth/change-password', {
          currentPassword: el.querySelector('#pw-current').value,
          newPassword: el.querySelector('#pw-new').value,
        });
        Api.setSession(session.token, session.user);
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
        const passphrase = await UI.passwordPrompt(
          'Encrypt your backup',
          'Use at least 12 characters. Keep this passphrase safe; it cannot be recovered.'
        );
        if (passphrase === null) return;
        const confirmation = await UI.passwordPrompt('Confirm backup passphrase', 'Enter the same passphrase again.');
        if (confirmation === null) return;
        if (passphrase !== confirmation) throw new Error('The passphrases do not match.');
        const encrypted = await BackupCrypto.encrypt(data, passphrase);
        const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `small-wins-encrypted-backup-${DateUtil.today()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        UI.alert(err.message || 'Could not create an encrypted backup.');
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
      status.className = 'form-success';
      status.textContent = '';
      try {
        let data;
        try { data = JSON.parse(await file.text()); } catch { throw new Error('That file isn\u2019t valid JSON.'); }
        if (BackupCrypto.isEncrypted(data)) {
          const passphrase = await UI.passwordPrompt('Decrypt backup', 'Enter the passphrase used when this backup was created.');
          if (passphrase === null) return;
          data = await BackupCrypto.decrypt(data, passphrase);
        }
        const preview = await Api.post('/export/import/preview', data);
        const categoryLines = Object.entries(preview.counts)
          .filter(([, count]) => count.toImport || count.toOverwrite || count.alreadyPresent || count.unreadable)
          .map(([key, count]) => `${key.replace(/_/g, ' ')}: ${count.toImport} new, ${count.toOverwrite} updated, ${count.alreadyPresent} already present, ${count.unreadable} unreadable`);
        const summary = [
          `New entries: ${preview.totals.toImport}`,
          `Existing budget values to replace: ${preview.totals.toOverwrite}`,
          `Already present: ${preview.totals.alreadyPresent}`,
          `Unreadable: ${preview.totals.unreadable}`,
          '',
          ...categoryLines,
          '',
          'Continue with this additive merge?',
        ].join('\n');
        if (!await UI.confirm(summary)) return;
        const result = await Api.post('/export/import', data);
        const overwritten = result.overwritten || 0;
        status.textContent = result.total || overwritten
          ? `Added ${result.total} new ${result.total === 1 ? 'entry' : 'entries'} and updated ${overwritten} budget${overwritten === 1 ? '' : 's'}${result.skipped ? ` (${result.skipped} already present or unreadable, skipped)` : ''}.`
          : 'Nothing new to import \u2014 everything in that file is already in your account.';
        if (result.total) { refreshXp(); setTimeout(() => render(el), 1200); }
      } catch (error) {
        status.className = 'form-error';
        status.textContent = error.message || 'Import failed.';
      } finally {
        event.target.value = '';
      }
    });

    el.querySelector('#add-sample-data').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!await UI.confirm('Add sample entries to this account? They will affect your dashboard, statistics, and money totals until you remove them.')) return;
      button.disabled = true;
      const status = el.querySelector('#sample-data-status');
      status.className = 'form-success';
      status.textContent = 'Adding sample entries…';
      try {
        await Api.post('/sample-data', {});
        UI.toast('Sample entries added. You can remove them from Settings.', { kind: 'win' });
        refreshXp();
        await render(el);
      } catch (error) {
        status.className = 'form-error';
        status.textContent = error.message || 'Could not add sample entries.';
        button.disabled = false;
      }
    });

    el.querySelector('#remove-sample-data').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!await UI.confirm('Remove the sample entries created by this feature? Your other entries will not be changed.')) return;
      button.disabled = true;
      const status = el.querySelector('#sample-data-status');
      status.className = 'form-success';
      status.textContent = 'Removing sample entries…';
      try {
        const result = await Api.del('/sample-data');
        UI.toast(`Removed ${result.removed} sample ${result.removed === 1 ? 'entry' : 'entries'}.`);
        refreshXp();
        await render(el);
      } catch (error) {
        status.className = 'form-error';
        status.textContent = error.message || 'Could not remove sample entries.';
        button.disabled = false;
      }
    });
  }

  return { render };
})();
