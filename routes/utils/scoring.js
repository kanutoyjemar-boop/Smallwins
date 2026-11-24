// Central scoring rules. Keeping this in one place means the dashboard,
// the daily view, and the monthly charts always agree on what a "good day"
// means.
//
// Rule of thumb: you only get graded on what you actually planned. A day
// with nothing scheduled isn't a poor day, it's a day with no data.

function rate(percentage) {
  if (percentage === null) return 'No data';
  if (percentage >= 90) return 'Excellent';
  if (percentage >= 75) return 'Great';
  if (percentage >= 50) return 'Fair';
  return 'Needs Work';
}

/**
 * Compute score for one half-day bucket ("AM" or "PM") of tasks.
 */
function scoreTasks(tasks) {
  const possible = tasks.reduce((s, t) => s + t.points, 0);
  const earned = tasks.reduce((s, t) => s + (t.done ? t.points : 0), 0);
  return { earned, possible };
}

function scoreWorkouts(workouts) {
  const possible = workouts.reduce((s, w) => s + w.points, 0);
  const earned = workouts.reduce((s, w) => s + (w.done ? w.points : 0), 0);
  return { earned, possible };
}

function scoreDiet(entries) {
  const possible = entries.reduce((s, e) => s + e.points, 0);
  const earned = entries.reduce((s, e) => s + (e.eaten ? e.points : 0), 0);
  return { earned, possible };
}

function scoreSchedule(items) {
  let earned = 0;
  let possible = 0;
  for (const it of items) {
    possible += it.points;
    if (it.status === 'done') earned += it.points;
    else if (it.status === 'overtime') earned += Math.round(it.points * 0.5);
    // pending / skipped earn 0
  }
  return { earned, possible };
}

/**
 * Money: reward staying within a set daily budget, penalize going over it.
 * If no budget was set for the day, money doesn't affect the score at all.
 */
function scoreMoney(budget, totalSpent) {
  if (!budget) return { earned: 0, possible: 0 };
  const BUDGET_POINTS = 15;
  const withinBudget = totalSpent <= Number(budget.daily_limit);
  return { earned: withinBudget ? BUDGET_POINTS : 0, possible: BUDGET_POINTS };
}

/**
 * Combine every module into one daily summary.
 * Input rows are already filtered to a single date for a single user.
 */
function computeDailySummary({ tasks, workouts, diet, schedule, budget, totalSpent }) {
  const amTasks = tasks.filter((t) => t.period === 'AM');
  const pmTasks = tasks.filter((t) => t.period === 'PM');

  const am = scoreTasks(amTasks);
  const pm = scoreTasks(pmTasks);
  const workout = scoreWorkouts(workouts);
  const dietScore = scoreDiet(diet);
  const scheduleScore = scoreSchedule(schedule);
  const money = scoreMoney(budget, totalSpent);

  const parts = [am, pm, workout, dietScore, scheduleScore, money];
  const earned = parts.reduce((s, p) => s + p.earned, 0);
  const possible = parts.reduce((s, p) => s + p.possible, 0);
  const percentage = possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null;

  return {
    am: { ...am, percentage: am.possible ? Math.round((am.earned / am.possible) * 100) : null },
    pm: { ...pm, percentage: pm.possible ? Math.round((pm.earned / pm.possible) * 100) : null },
    workout,
    diet: dietScore,
    schedule: scheduleScore,
    money,
    earned,
    possible,
    percentage,
    rating: rate(percentage),
  };
}

module.exports = { computeDailySummary, rate };
