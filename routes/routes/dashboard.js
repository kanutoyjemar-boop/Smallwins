const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getDay, getRangeSummaries, todayStr } = require('../utils/summaries');
const { computeStreak, computeBadges } = require('../utils/streaks');
const { computeWeekSummary } = require('../utils/insights');
const { dashboardMessage } = require('../utils/motivation');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard?date=2026-09-15
// Full picture for one day: every module's rows plus the computed score,
// today's streak, and a short motivational line.
router.get('/', async (req, res) => {
  const date = req.query.date || todayStr();
  const userId = req.userId;

  const day = await getDay(userId, date);
  const streakStats = date === todayStr() ? await computeStreak(userId) : null;
  const motivation = date === todayStr() ? dashboardMessage(day.summary, streakStats) : null;

  res.json({ ...day, streak: streakStats ? streakStats.streak : null, motivation });
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

// GET /api/dashboard/week -> 7-day momentum snapshot and upcoming focus goals.
router.get('/week', async (req, res) => {
  const today = todayStr();
  const start = new Date(today + 'T00:00:00');
  start.setDate(start.getDate() - 6);
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

  const [days, goals, reflection] = await Promise.all([
    getRangeSummaries(req.userId, startStr, today),
    pool.query(
      'SELECT * FROM focus_goals WHERE user_id = $1 AND goal_date BETWEEN $2 AND $3 ORDER BY goal_date, id',
      [req.userId, startStr, today]
    ),
    pool.query('SELECT * FROM daily_reflections WHERE user_id = $1 AND entry_date = $2', [req.userId, today]),
  ]);

  res.json({
    weekly: computeWeekSummary(days),
    focusGoals: goals.rows,
    reflection: reflection.rows[0] || null,
  });
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

  res.json({ ...totals, ...streakStats, badges, milestones: milestones.rows });
});

module.exports = router;
