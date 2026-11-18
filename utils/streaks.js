// Turns a user's history into a "current streak" number and a list of
// badges. Nothing here is stored — it's cheap enough to recompute from the
// last few months of rows, and it means the numbers can never drift out of
// sync with the underlying data.

const { getRangeSummaries, todayStr } = require('./summaries');
const { addDays } = require('./date');

const GOOD_DAY_THRESHOLD = 60; // percentage that keeps a streak alive
const LOOKBACK_DAYS = 120;
const MAX_CONSECUTIVE_GAPS = 2; // "no data" days in a row before we call it broken

/**
 * Current streak = consecutive days (counting backward from today, or from
 * yesterday if today has no data yet) that scored at or above the
 * threshold. Days with nothing planned are skipped without breaking the
 * streak, up to a small gap tolerance, so a couple of rest days don't
 * torch weeks of progress.
 */
async function computeStreak(userId) {
  const today = todayStr();
  const start = addDays(today, -LOOKBACK_DAYS);
  const days = await getRangeSummaries(userId, start, today);
  const byDate = {};
  for (const d of days) byDate[d.date] = d;

  let streak = 0;
  let bestStreak = 0;
  let running = 0;
  let gapRun = 0;
  let cursor = today;

  // If today isn't scored yet (nothing done so far), start counting from
  // yesterday so an in-progress day never looks like a broken streak.
  if (!byDate[today] || byDate[today].percentage === null) {
    cursor = addDays(today, -1);
  }

  let counting = true;
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const day = byDate[cursor];
    const pct = day ? day.percentage : null;

    if (pct === null) {
      gapRun += 1;
      if (counting && gapRun > MAX_CONSECUTIVE_GAPS) counting = false;
    } else {
      gapRun = 0;
      if (pct >= GOOD_DAY_THRESHOLD) {
        running += 1;
        if (counting) streak = running;
        bestStreak = Math.max(bestStreak, running);
      } else {
        running = 0;
        counting = false;
      }
    }
    cursor = addDays(cursor, -1);
  }

  const excellentDays = days.filter((d) => d.rating === 'Excellent').length;
  const greatOrBetterDays = days.filter((d) => d.rating === 'Excellent' || d.rating === 'Great').length;
  const perfectDays = days.filter((d) => d.percentage === 100).length;

  return { streak, bestStreak, excellentDays, greatOrBetterDays, perfectDays };
}

const BADGE_DEFS = [
  { id: 'streak_3', label: '3-Day Streak', icon: '🔥', check: (s) => s.streak >= 3 },
  { id: 'streak_7', label: 'Week Warrior', icon: '⚡', check: (s) => s.streak >= 7 },
  { id: 'streak_14', label: 'Two-Week Grind', icon: '💪', check: (s) => s.streak >= 14 },
  { id: 'streak_30', label: 'Iron Month', icon: '🏆', check: (s) => s.streak >= 30 },
  { id: 'excellent_5', label: '5 Excellent Days', icon: '🌟', check: (s) => s.excellentDays >= 5 },
  { id: 'perfect_1', label: 'Perfect Day', icon: '💯', check: (s) => s.perfectDays >= 1 },
  { id: 'level_5', label: 'Level 5', icon: '🎮', check: (s, totals) => totals && totals.level >= 5 },
];

function computeBadges(streakStats, totals) {
  return BADGE_DEFS
    .filter((b) => b.check(streakStats, totals))
    .map((b) => ({ id: b.id, label: b.label, icon: b.icon }));
}

function badgeIcon(id) {
  const def = BADGE_DEFS.find((b) => b.id === id);
  return def ? def.icon : '🏅';
}

module.exports = { computeStreak, computeBadges, badgeIcon, GOOD_DAY_THRESHOLD };
