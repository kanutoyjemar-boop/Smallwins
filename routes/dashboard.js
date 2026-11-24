const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getDay, getRangeSummaries, getScoringWeights, todayStr } = require('../utils/summaries');
const { computeStreak, computeBadges, badgeIcon } = require('../utils/streaks');
const { computeWeekSummary, weeklyRecap } = require('../utils/insights');
const { addDays, parseDateKey, toDateKey } = require('../utils/date');
const { dashboardMessage } = require('../utils/motivation');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard?date=2026-09-15
// Full picture for one day: every module's rows plus the computed score,
// today's streak, and a short motivational line.
router.get('/', async (req, res) => {
  const date = req.query.date || todayStr();
  const userId = req.userId;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(parseDateKey(date)) !== date) {
    return res.status(400).json({ error: 'A valid date is required.' });
  }

  const day = await getDay(userId, date);
  const selectedDate = parseDateKey(date);
  const weekStart = addDays(date, -((selectedDate.getDay() + 6) % 7));
  const [plan, checkin] = await Promise.all([
    pool.query('SELECT focus FROM weekly_plans WHERE user_id = $1 AND week_start = $2', [userId, weekStart]),
    pool.query('SELECT 1 FROM weekly_focus_checkins WHERE user_id = $1 AND check_date = $2', [userId, date]),
  ]);
  const streakStats = date === todayStr() ? await computeStreak(userId) : null;
  const motivation = date === todayStr() ? dashboardMessage(day.summary, streakStats) : null;

  res.json({
    ...day,
    weeklyFocus: plan.rows[0] ? plan.rows[0].focus : '',
    weeklyFocusChecked: Boolean(checkin.rows.length),
    streak: streakStats ? streakStats.streak : null,
    motivation,
  });
});

// GET /api/dashboard/monthly?month=2026-09
// One row per day of the month, used to draw the monthly chart & calendar.
router.get('/monthly', async (req, res) => {
  const month = req.query.month || todayStr().slice(0, 7); // YYYY-MM
  const start = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const days = await getRangeSummaries(req.userId, start, end);
  res.json({ month, days });
});

// GET /api/dashboard/strip?date=YYYY-MM-DD -> selected day plus the next six days and rolling recap.
router.get('/strip', async (req, res) => {
  const today = todayStr();
  const date = req.query.date || today;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(parseDateKey(date)) !== date) {
    return res.status(400).json({ error: 'A valid date is required.' });
  }
  const selectedRangeEnd = addDays(date, 6);
  const rollingWeekStart = addDays(today, -6);
  const [days, rollingDays] = await Promise.all([
    getRangeSummaries(req.userId, date, selectedRangeEnd),
    getRangeSummaries(req.userId, rollingWeekStart, today),
  ]);
  res.json({
    days: days.map((d) => ({ date: d.date, percentage: d.percentage })),
    past: rollingDays.map((d) => ({ date: d.date, percentage: d.percentage })),
    recap: computeWeekSummary(rollingDays),
  });
});

// GET /api/dashboard/week -> selected calendar week's momentum and focus.
router.get('/week', async (req, res) => {
  const date = req.query.date || todayStr();
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(parseDateKey(date)) !== date) {
    return res.status(400).json({ error: 'A valid date is required.' });
  }
  const selectedDate = parseDateKey(date);
  const weekStart = addDays(date, -((selectedDate.getDay() + 6) % 7));
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(weekStart, -1);
  const weekEnd = addDays(weekStart, 6);
  const summaryEnd = date < todayStr() ? date : todayStr();

  const [days, goals, reflection, plan, checkins, weights] = await Promise.all([
    getRangeSummaries(req.userId, previousWeekStart, summaryEnd < previousWeekEnd ? previousWeekEnd : summaryEnd),
    pool.query(
      'SELECT * FROM focus_goals WHERE user_id = $1 AND goal_date BETWEEN $2 AND $3 ORDER BY goal_date, id',
      [req.userId, weekStart, weekEnd]
    ),
    pool.query('SELECT * FROM daily_reflections WHERE user_id = $1 AND entry_date = $2', [req.userId, date]),
    pool.query('SELECT focus, rest_days FROM weekly_plans WHERE user_id = $1 AND week_start = $2', [req.userId, weekStart]),
    pool.query(
      'SELECT COUNT(*)::int AS count FROM weekly_focus_checkins WHERE user_id = $1 AND check_date BETWEEN $2 AND $3',
      [req.userId, weekStart, summaryEnd]
    ),
    getScoringWeights(req.userId),
  ]);

  const previousDays = days.filter((day) => day.date < weekStart);
  const currentDays = days.filter((day) => day.date >= weekStart && day.date <= summaryEnd);
  const weekly = computeWeekSummary(currentDays);
  const previousWeekly = computeWeekSummary(previousDays);
  const [activityResult, pendingAgendaResult, pendingTasksResult] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tasks WHERE user_id = $1 AND task_date BETWEEN $2 AND $3) AS tasks_planned,
         (SELECT COUNT(*)::int FROM tasks WHERE user_id = $1 AND task_date BETWEEN $2 AND $3 AND done) AS tasks_completed,
         (SELECT COUNT(*)::int FROM workouts WHERE user_id = $1 AND workout_date BETWEEN $2 AND $3) AS workouts_planned,
         (SELECT COUNT(*)::int FROM workouts WHERE user_id = $1 AND workout_date BETWEEN $2 AND $3 AND done) AS workouts_completed,
         (SELECT COUNT(*)::int FROM diet_entries WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3) AS meals_planned,
         (SELECT COUNT(*)::int FROM diet_entries WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3 AND eaten) AS meals_completed,
         (SELECT COUNT(*)::int FROM schedule_items WHERE user_id = $1 AND item_date BETWEEN $2 AND $3) AS agenda_planned,
         (SELECT COUNT(*)::int FROM schedule_items WHERE user_id = $1 AND item_date BETWEEN $2 AND $3 AND status IN ('done','overtime')) AS agenda_completed`,
      [req.userId, weekStart, summaryEnd]
    ),
    pool.query(
      `SELECT id, to_char(item_date, 'YYYY-MM-DD') AS item_date, title, start_time, planned_minutes
       FROM schedule_items
       WHERE user_id = $1 AND item_date BETWEEN $2 AND $3 AND status = 'pending' AND item_date < $4
       ORDER BY item_date, start_time NULLS LAST, id`,
      [req.userId, weekStart, summaryEnd, todayStr()]
    ),
    pool.query(
      `SELECT id, to_char(task_date, 'YYYY-MM-DD') AS task_date, period, title
       FROM tasks
       WHERE user_id = $1 AND task_date BETWEEN $2 AND $3 AND NOT done AND task_date < $4
       ORDER BY task_date, period, id`,
      [req.userId, weekStart, summaryEnd, todayStr()]
    ),
  ]);

  res.json({
    weekStart,
    previousWeekStart,
    weekly,
    previousWeekly,
    recap: weeklyRecap(currentDays, weights),
    focus: plan.rows[0] ? plan.rows[0].focus : '',
    restDays: plan.rows[0] ? plan.rows[0].rest_days : [],
    focusCheckins: checkins.rows[0].count,
    focusGoals: goals.rows,
    reflection: reflection.rows[0] || null,
    activity: activityResult.rows[0],
    pendingAgenda: pendingAgendaResult.rows,
    pendingTasks: pendingTasksResult.rows,
  });
});

router.put('/week/checkin', async (req, res) => {
  const { date, checked } = req.body || {};
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(parseDateKey(date)) !== date) {
    return res.status(400).json({ error: 'A valid check-in date is required.' });
  }
  if (date > todayStr()) return res.status(400).json({ error: 'You can check in once the day has started.' });
  if (typeof checked !== 'boolean') {
    return res.status(400).json({ error: 'Check-in status must be true or false.' });
  }
  const weekStart = addDays(date, -((parseDateKey(date).getDay() + 6) % 7));
  const plan = await pool.query(
    'SELECT 1 FROM weekly_plans WHERE user_id = $1 AND week_start = $2 AND btrim(focus) <> $3',
    [req.userId, weekStart, '']
  );
  if (!plan.rows.length) return res.status(409).json({ error: 'Set a weekly focus before checking in.' });

  if (checked) {
    await pool.query(
      'INSERT INTO weekly_focus_checkins (user_id, check_date) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.userId, date]
    );
  } else {
    await pool.query('DELETE FROM weekly_focus_checkins WHERE user_id = $1 AND check_date = $2', [req.userId, date]);
  }
  res.json({ date, checked });
});

router.put('/week/focus', async (req, res) => {
  const { week_start: weekStart, focus } = req.body || {};
  const restDays = req.body && req.body.rest_days;
  if (
    typeof weekStart !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
    toDateKey(parseDateKey(weekStart)) !== weekStart ||
    parseDateKey(weekStart).getDay() !== 1
  ) {
    return res.status(400).json({ error: 'A valid Monday week start is required.' });
  }
  if (typeof focus !== 'string' || focus.trim().length > 140) {
    return res.status(400).json({ error: 'Focus must be 140 characters or fewer.' });
  }
  if (restDays !== undefined && (!Array.isArray(restDays)
    || restDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
    return res.status(400).json({ error: 'Rest days must be weekdays numbered 0 through 6.' });
  }

  const result = await pool.query(
    `INSERT INTO weekly_plans (user_id, week_start, focus, rest_days)
     VALUES ($1, $2, $3, $4::smallint[])
     ON CONFLICT (user_id, week_start)
     DO UPDATE SET
       focus = EXCLUDED.focus,
       rest_days = CASE WHEN $5::boolean THEN EXCLUDED.rest_days ELSE weekly_plans.rest_days END,
       updated_at = now()
     RETURNING focus, rest_days`,
    [req.userId, weekStart, focus.trim(), [...new Set(restDays || [])], restDays !== undefined]
  );
  res.json(result.rows[0]);
});

// GET /api/dashboard/totals -> lifetime XP + level + streak + badges.
router.get('/totals', async (req, res) => {
  const userId = req.userId;
  const [t, w, d, s] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(points),0) AS xp FROM tasks WHERE user_id=$1 AND done=true', [userId]),
    pool.query('SELECT COALESCE(SUM(points),0) AS xp FROM workouts WHERE user_id=$1 AND done=true', [userId]),
    pool.query('SELECT COALESCE(SUM(points),0) AS xp FROM diet_entries WHERE user_id=$1 AND eaten=true', [userId]),
    pool.query(
      "SELECT COALESCE(SUM(CASE WHEN status='done' THEN points WHEN status='overtime' THEN ROUND(points*0.5) ELSE 0 END),0) AS xp FROM schedule_items WHERE user_id=$1",
      [userId]
    ),
  ]);
  const xp = Number(t.rows[0].xp) + Number(w.rows[0].xp) + Number(d.rows[0].xp) + Number(s.rows[0].xp);
  const XP_PER_LEVEL = 500;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;

  const streakStats = await computeStreak(userId);
  const totals = { xp, level, xpIntoLevel, xpPerLevel: XP_PER_LEVEL };
  const badges = computeBadges(streakStats, totals);
  for (const badge of badges) {
    await pool.query(
      `INSERT INTO achievement_milestones (user_id, milestone_key, label)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, milestone_key) DO NOTHING`,
      [userId, badge.id, badge.label]
    );
  }
  const milestones = await pool.query(
    'SELECT milestone_key, label, achieved_at FROM achievement_milestones WHERE user_id=$1 ORDER BY achieved_at DESC',
    [userId]
  );

  const history = milestones.rows.map((m) => ({ ...m, icon: badgeIcon(m.milestone_key) }));

  res.json({ ...totals, ...streakStats, badges, milestones: history });
});

module.exports = router;
