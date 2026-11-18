const PageStats = (() => {
  let month = DateUtil.today().slice(0, 7);
  let metric = 'overall';
  let chartInstance = null;

  const METRICS = [
    { id: 'overall', label: 'Overall', color: '#e8b54d', get: (d) => d.percentage },
    { id: 'tasks', label: 'Tasks', color: '#e8b54d', get: (d) => pct(d.am.earned + d.pm.earned, d.am.possible + d.pm.possible) },
    { id: 'agenda', label: 'Punctuality', color: '#6c8cff', get: (d) => pct(d.schedule.earned, d.schedule.possible) },
    { id: 'workout', label: 'Workouts', color: '#9b87f5', get: (d) => pct(d.workout.earned, d.workout.possible) },
    { id: 'diet', label: 'Diet', color: '#c48bf5', get: (d) => pct(d.diet.earned, d.diet.possible) },
    { id: 'money', label: 'Money', color: '#4fd1ae', get: (d) => pct(d.money.earned, d.money.possible) },
  ];

  function pct(earned, possible) {
    return possible > 0 ? Math.round((earned / possible) * 100) : null;
  }

  async function render(el) {
    const { days } = await Api.get(`/dashboard/monthly?month=${month}`);

    const scored = days.filter((d) => d.percentage != null);
    const avg = scored.length ? Math.round(scored.reduce((s, d) => s + d.percentage, 0) / scored.length) : null;
    const counts = { Excellent: 0, Great: 0, Fair: 0, 'Room to Adjust': 0 };
    scored.forEach((d) => { if (counts[d.rating] !== undefined) counts[d.rating]++; });

    const activeMetric = METRICS.find((m) => m.id === metric);
    const metricValues = days.map((d) => activeMetric.get(d)).filter((v) => v != null);
    const metricAvg = metricValues.length ? Math.round(metricValues.reduce((s, v) => s + v, 0) / metricValues.length) : null;

    el.innerHTML = `
      <div class="date-nav">
        <button data-mon="-1">‹</button>
        <div class="date-label">${DateUtil.monthLabel(month)}</div>
        <button data-mon="1">›</button>
      </div>

      <div class="panel score-hero">
        <div class="score-ring" style="background:conic-gradient(${avg == null ? 'var(--nodata) 0 100%' : `var(--tasks) ${avg * 3.6}deg, var(--surface-2) 0deg`})">
          <div class="ring-num"><span class="pct">${avg == null ? '—' : avg}</span><span class="pct-sym">${avg == null ? '' : '%'}</span></div>
        </div>
        <div>
          <p class="rating-label">Monthly average</p>
          <p class="rating-sub">${scored.length} scored day${scored.length === 1 ? '' : 's'} this month</p>
        </div>
      </div>

      <div class="rating-grid">
        ${ratingCell('Excellent', counts.Excellent, 'var(--excellent)')}
        ${ratingCell('Great', counts.Great, 'var(--great)')}
        ${ratingCell('Fair', counts.Fair, 'var(--fair)')}
        ${ratingCell('Room to Adjust', counts['Room to Adjust'], 'var(--fair)')}
      </div>

      <div class="section-label">Trend by module</div>
      <div class="chip-row">
        ${METRICS.map((m) => `
          <button class="chip-btn ${m.id === metric ? 'active' : ''}" data-metric="${m.id}" style="--chip-color:${m.color}">${m.label}</button>
        `).join('')}
      </div>
      <div class="panel" style="padding-bottom:6px">
        <div class="row" style="justify-content:space-between; align-items:baseline; margin-bottom:4px">
          <span class="rating-sub" style="margin:0">${activeMetric.label} this month</span>
          <span class="rating-sub" style="margin:0; font-weight:600; color:${activeMetric.color}">${metricAvg == null ? 'No data' : `${metricAvg}% avg`}</span>
        </div>
        <div class="chart-wrap" style="margin:0; border:none; padding:10px 0 0"><canvas id="trend-chart" height="180"></canvas></div>
      </div>

      <div class="section-label">Calendar (overall)</div>
      <div class="panel">
        <div class="calendar-grid">${days.map(calCell).join('')}</div>
      </div>
    `;

    el.querySelectorAll('[data-mon]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [y, m] = month.split('-').map(Number);
        const d = new Date(y, m - 1 + Number(btn.dataset.mon), 1);
        month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        render(el);
      });
    });

    el.querySelectorAll('[data-metric]').forEach((btn) => {
      btn.addEventListener('click', () => {
        metric = btn.dataset.metric;
        render(el);
      });
    });

    el.querySelectorAll('[data-cal-date]').forEach((cell) => {
      cell.addEventListener('click', () => {
        AppState.date = cell.dataset.calDate;
        window.location.hash = '#/';
      });
    });

    drawChart(days, activeMetric);
  }

  function ratingCell(label, count, color) {
    return `<div class="rating-cell"><div class="rc-count" style="color:${color}">${count}</div><div class="rc-label">${label}</div></div>`;
  }

  function calCell(d) {
    const day = Number(d.date.slice(-2));
    const color = d.percentage == null ? 'var(--surface-2)' : ratingColorVar(d.rating);
    const opacity = d.percentage == null ? '1' : '0.85';
    return `<button class="cal-cell" data-cal-date="${d.date}" type="button" style="background:${color}; opacity:${opacity}" title="${d.date}: ${d.percentage ?? 'no data'}" aria-label="${d.date}: ${d.percentage ?? 'no data'}">${day}</button>`;
  }

  function drawChart(days, activeMetric) {
    const ctx = document.getElementById('trend-chart');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, `${activeMetric.color}66`);
    gradient.addColorStop(1, `${activeMetric.color}08`);

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: days.map((d) => Number(d.date.slice(-2))),
        datasets: [{
          data: days.map((d) => activeMetric.get(d)),
          borderColor: activeMetric.color,
          backgroundColor: gradient,
          borderWidth: 3,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: activeMetric.color,
          pointBorderColor: '#12141c',
          pointBorderWidth: 2,
          spanGaps: true,
          fill: true,
          tension: 0.38,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1b1e29', borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, titleColor: '#edeff5', bodyColor: '#edeff5' } },
        scales: {
          x: { ticks: { color: '#8b8fa6', maxTicksLimit: 10 }, grid: { display: false }, border: { display: false } },
          y: { min: 0, max: 100, ticks: { color: '#8b8fa6', stepSize: 25 }, grid: { color: 'rgba(140,146,170,0.18)', drawBorder: false }, border: { display: false } },
        },
      },
    });
  }

  return { render };
})();
