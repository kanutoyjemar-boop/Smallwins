const PageDashboard = (() => {
  async function render(el) {
    const date = AppState.date;
    const data = await Api.get(`/dashboard?date=${date}`);
    el.innerHTML = template(data, date);
    wire(el);
    refreshXp();
  }

  function template(data, date) {
    const s = data.summary;
    const pct = s.percentage;
    const color = ratingColorVar(s.rating);
    const ringStyle = pct == null
      ? `background: conic-gradient(var(--nodata) 0 100%);`
      : `background: conic-gradient(${color} ${pct * 3.6}deg, var(--surface-2) 0deg);`;

    const workoutsDone = data.workouts.filter((w) => w.done).length;
    const dietEaten = data.diet.filter((d) => d.eaten).length;
    const agendaDone = data.schedule.filter((s2) => s2.status === 'done' || s2.status === 'overtime').length;
    const pendingTasks = data.tasks.filter((task) => !task.done);
    const pendingAgenda = data.schedule.filter((item) => item.status === 'pending');

    return `
      <div class="date-nav">
        <button data-nav="-1" aria-label="Previous day">‹</button>
        <div class="date-label">${DateUtil.label(date)}</div>
        <button data-nav="1" aria-label="Next day">›</button>
      </div>

      ${date === DateUtil.today() && (pendingTasks.length || pendingAgenda.length) ? `
        <button class="daily-brief-trigger" id="open-daily-brief" type="button">
          <span class="daily-brief-icon">!</span>
          <span><strong>${pendingTasks.length + pendingAgenda.length} things need your attention</strong><small>Open your daily brief</small></span>
          <span class="daily-brief-arrow" aria-hidden="true">›</span>
        </button>
        ${dailyBriefModal(pendingTasks, pendingAgenda)}
      ` : ''}

      ${data.motivation ? `
        <div class="panel motivation-banner">
          ${data.streak ? `<span class="streak-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c2.5 2.7 4 4.7 4 7.2A4.5 4.5 0 0 1 7.5 15c0-2.5 1.5-4.5 4.5-7.5Z"/><path d="M10.5 14.3c.6 1.4 1.8 2.2 3.2 2.7"/></svg>${data.streak}</span>` : ''}
          <p>${escapeHtml(data.motivation)}</p>
        </div>
      ` : ''}
      ${pushNudgeHtml()}

      <div class="panel score-hero">
        <div class="score-ring" style="${ringStyle}">
          <div class="ring-num">
            <span class="pct">${pct == null ? '—' : pct}</span>
            <span class="pct-sym">${pct == null ? '' : '%'}</span>
          </div>
        </div>
        <div>
          <p class="rating-label" style="color:${color}">${s.rating}</p>
          <p class="rating-sub">${pct == null ? 'Nothing planned yet today.' : `${s.earned} of ${s.possible} points earned`}</p>
        </div>
      </div>

      <div class="halfday-row">
        ${halfCard('AM', s.am)}
        ${halfCard('PM', s.pm)}
      </div>

      ${localStorage.getItem('selfup_sharing_enabled') !== 'false' ? `<div class="panel share-panel">
        <div class="panel-title"><h3>Celebrate your win</h3></div>
        <p class="rating-sub" style="margin:0 0 12px">Share today’s progress with your friends on Facebook or Instagram.</p>
        <div class="achievement-card" id="achievement-card">
          <div class="achievement-brand">SELFUP <span>DAILY PROGRESS</span></div>
          <div class="achievement-score">${pct == null ? '—' : pct}<small>${pct == null ? '' : '%'}</small></div>
          <div class="achievement-rating" style="color:${color}">${escapeHtml(s.rating)}</div>
          <div class="achievement-date">${escapeHtml(DateUtil.label(date))}</div>
        </div>
        <div class="share-actions">
          <button class="btn btn-primary btn-sm" id="share-achievement" type="button">Share</button>
          <button class="btn btn-ghost btn-sm" data-share="facebook" type="button">Facebook</button>
          <button class="btn btn-ghost btn-sm" data-share="instagram" type="button">Instagram</button>
          <button class="btn btn-ghost btn-sm" id="download-achievement" type="button">Download card</button>
        </div>
      </div>` : ''}

      <div class="section-label">Today at a glance</div>
      <div class="stat-grid">
        <a class="stat-card" href="#/money" style="--accent:var(--money)">
          <div class="sc-label">Money spent</div>
          <div class="sc-value">₱${data.totalSpent.toFixed(0)}${data.budget ? ` / ₱${Number(data.budget.daily_limit).toFixed(0)}` : ''}</div>
        </a>
        <a class="stat-card" href="#/body" style="--accent:var(--body)">
          <div class="sc-label">Workouts</div>
          <div class="sc-value">${workoutsDone}/${data.workouts.length} done</div>
        </a>
        <a class="stat-card" href="#/body" style="--accent:var(--body)">
          <div class="sc-label">Diet</div>
          <div class="sc-value">${dietEaten}/${data.diet.length} meals</div>
        </a>
        <a class="stat-card" href="#/schedule" style="--accent:var(--agenda)">
          <div class="sc-label">Agenda</div>
          <div class="sc-value">${agendaDone}/${data.schedule.length} items</div>
        </a>
      </div>
    `;
  }

  function pushNudgeHtml() {
    if (AppState.date !== DateUtil.today()) return '';
    if (sessionStorage.getItem('selfup_push_nudge_dismissed')) return '';
    if (!window.Push || !Push.supported() || Push.permission() !== 'default') return '';
    return `
      <div class="panel push-nudge">
        <p>Turn on reminders and SelfUp will nudge your phone in the morning, in the evening, and if your streak's at risk.</p>
        <div class="row">
          <button class="btn btn-primary btn-sm" id="nudge-enable" type="button">Enable notifications</button>
          <button class="btn btn-ghost btn-sm" id="nudge-dismiss" type="button">Not now</button>
        </div>
      </div>
    `;
  }

  function halfCard(label, part) {
    const pct = part.percentage;
    return `
      <div class="halfday-card">
        <div class="hd-label">${label} tasks</div>
        <div class="hd-value">${pct == null ? '—' : pct + '%'}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct || 0}%; background:${label === 'AM' ? 'var(--tasks)' : 'var(--agenda)'}"></div></div>
      </div>
    `;
  }

  function wire(el) {
    el.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        AppState.date = DateUtil.addDays(AppState.date, Number(btn.dataset.nav));
        render(el);
      });
    });

    const enableBtn = el.querySelector('#nudge-enable');
    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        enableBtn.disabled = true;
        enableBtn.textContent = 'Enabling…';
        try {
          await Push.enable();
          sessionStorage.setItem('selfup_push_nudge_dismissed', '1');
          render(el);
        } catch (e) {
          enableBtn.disabled = false;
          enableBtn.textContent = 'Enable notifications';
          alert(e.message);
        }
      });
    }
    const dismissBtn = el.querySelector('#nudge-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        sessionStorage.setItem('selfup_push_nudge_dismissed', '1');
        render(el);
      });
    }

    const dailyBrief = el.querySelector('#daily-brief-modal');
    const openBrief = el.querySelector('#open-daily-brief');
    const closeBrief = () => {
      if (!dailyBrief) return;
      dailyBrief.classList.remove('is-open');
      dailyBrief.setAttribute('aria-hidden', 'true');
      localStorage.setItem(`selfup_daily_brief_${AppState.date}`, '1');
    };
    const showBrief = () => {
      if (!dailyBrief) return;
      dailyBrief.classList.add('is-open');
      dailyBrief.setAttribute('aria-hidden', 'false');
      dailyBrief.querySelector('[data-close-brief]')?.focus();
    };
    if (openBrief) openBrief.addEventListener('click', showBrief);
    if (dailyBrief) {
      dailyBrief.querySelectorAll('[data-close-brief]').forEach((button) => button.addEventListener('click', closeBrief));
      dailyBrief.addEventListener('click', (event) => { if (event.target === dailyBrief) closeBrief(); });
      if (!localStorage.getItem(`selfup_daily_brief_${AppState.date}`)) setTimeout(showBrief, 450);
    }
    const briefKeyHandler = (event) => { if (event.key === 'Escape' && dailyBrief?.classList.contains('is-open')) closeBrief(); };
    document.addEventListener('keydown', briefKeyHandler, { once: true });

    const shareBtn = el.querySelector('#share-achievement');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        const shareText = buildShareMessage();
        await shareAchievement(shareText, 'native');
      });
    }

    el.querySelectorAll('[data-share]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const shareText = buildShareMessage();
        await shareAchievement(shareText, btn.dataset.share);
      });
    });

    const downloadBtn = el.querySelector('#download-achievement');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => downloadAchievementCard(el));
    }
  }

  function dailyBriefModal(tasks, agenda) {
    return `
      <div class="daily-brief-backdrop" id="daily-brief-modal" role="dialog" aria-modal="true" aria-labelledby="daily-brief-title" aria-hidden="true">
        <div class="daily-brief-modal">
          <button class="daily-brief-close" type="button" data-close-brief aria-label="Close daily brief">×</button>
          <span class="eyebrow">DAILY BRIEF</span>
          <h2 id="daily-brief-title">Make today count.</h2>
          <p class="rating-sub">Here is what still needs your attention.</p>
          <div class="brief-list">
            ${tasks.slice(0, 5).map((task) => `<a href="#/tasks" class="brief-item" data-close-brief><span class="brief-dot task-dot"></span><span><strong>${escapeHtml(task.title)}</strong><small>${task.period} task</small></span><span aria-hidden="true">›</span></a>`).join('')}
            ${agenda.slice(0, 5).map((item) => `<a href="#/schedule" class="brief-item" data-close-brief><span class="brief-dot agenda-dot"></span><span><strong>${escapeHtml(item.title)}</strong><small>${item.start_time ? formatBriefTime(item.start_time) : 'Agenda item'}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</small></span><span aria-hidden="true">›</span></a>`).join('')}
          </div>
          <button class="btn btn-primary btn-block" type="button" data-close-brief>Got it</button>
        </div>
      </div>
    `;
  }

  function formatBriefTime(time) {
    const [hours, minutes] = String(time).split(':').map(Number);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
  }

  function buildShareMessage() {
    const date = AppState.date;
    const today = DateUtil.today();
    const title = date === today ? 'today' : DateUtil.label(date);
    const score = document.querySelector('.ring-num .pct');
    const rating = document.querySelector('.rating-label');
    const summaryText = score && score.textContent && score.textContent !== '—'
      ? `${score.textContent}% discipline score`
      : 'a strong discipline day';
    const ratingText = rating ? rating.textContent : 'good progress';

    return `I just completed ${title} in SelfUp with ${summaryText} and a rating of ${ratingText}. Small wins every day build a better life. #SelfUp #Discipline #Growth`;
  }

  async function shareAchievement(message, platform = 'native') {
    const shareUrl = `${window.location.origin}/#/`;

    if (platform === 'native' && navigator.share) {
      try {
        await navigator.share({
          title: 'SelfUp achievement',
          text: message,
          url: shareUrl,
        });
        return;
      } catch (err) {
        // fall through to manual sharing if the user cancels
      }
    }

    if (platform === 'facebook') {
      const fbUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(message)}`;
      window.open(fbUrl, '_blank', 'noopener,noreferrer,width=600,height=500');
      return;
    }

    if (platform === 'instagram') {
      try {
        await navigator.clipboard.writeText(`${message}\n\n${shareUrl}`);
      } catch (err) {
        // no clipboard support, keep going
      }
      window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
      alert('Your achievement text was copied. Open Instagram and paste it into your post.');
      return;
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(`${message}\n\n${shareUrl}`);
      alert('Achievement copied — share it on Facebook or Instagram.');
      return;
    }

    alert('Sharing is not available in this browser. Copy your text manually and post it to your social channel.');
  }

  function downloadAchievementCard(root) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    const score = root.querySelector('.achievement-score')?.textContent.trim() || '—';
    const rating = root.querySelector('.achievement-rating')?.textContent.trim() || 'Progress';
    const date = root.querySelector('.achievement-date')?.textContent.trim() || 'Today';
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1080);
    gradient.addColorStop(0, '#1b1e29');
    gradient.addColorStop(1, '#303753');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8b54d';
    ctx.fillRect(72, 72, 120, 10);
    ctx.fillStyle = '#edeff5';
    ctx.font = '700 42px Arial';
    ctx.fillText('SELFUP', 72, 160);
    ctx.fillStyle = '#8b8fa6';
    ctx.font = '500 22px Arial';
    ctx.fillText('DAILY PROGRESS', 72, 198);
    ctx.fillStyle = '#edeff5';
    ctx.font = '700 240px Arial';
    ctx.fillText(score, 72, 560);
    ctx.fillStyle = '#4fd1ae';
    ctx.font = '700 54px Arial';
    ctx.fillText(rating, 78, 680);
    ctx.fillStyle = '#8b8fa6';
    ctx.font = '500 30px Arial';
    ctx.fillText(date, 78, 750);
    ctx.fillStyle = '#edeff5';
    ctx.font = '500 28px Arial';
    ctx.fillText('Small wins every day build a better life.', 78, 920);
    const link = document.createElement('a');
    link.download = `selfup-${AppState.date}-achievement.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return { render };
})();
