// Shared data-access helpers for turning a user's raw rows into scored
// daily summaries. Pulled out of routes/dashboard.js so the notification
// scheduler and the streak/badge calculator can reuse the exact same
// queries and math instead of drifting out of sync with the dashboard.

const { pool } = require('../db');
const { computeDailySummary } = require('./scoring');
const { toDateKey } = require('./date');

function todayStr() {
  return toDateKey(new Date());
}

async function getScoringWeights(userId) {
  const result = await pool.query(
    'SELECT tasks, workouts, diet, schedule, money FROM scoring_preferences WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || { tasks: 1, workouts: 1, diet: 1, schedule: 1, money: 1 };
}

// Full picture for one day: every module's rows plus the computed score.
async function getDay(userId, date) {
  await require('./recurring').ensureRecurring(userId, date);
  const [tasks, workouts, diet, schedule, expenses, budget, weights] = await Promise.all([
    pool.query('SELECT * FROM tasks WHERE user_id=$1 AND task_date=$2 ORDER BY period, id', [userId, date]),
    pool.query('SELECT * FROM workouts WHERE user_id=$1 AND workout_date=$2 ORDER BY id', [userId, date]),
    pool.query('SELECT * FROM diet_entries WHERE user_id=$1 AND entry_date=$2 ORDER BY id', [userId, date]),
    pool.query('SELECT * FROM schedule_items WHERE user_id=$1 AND item_date=$2 ORDER BY start_time NULLS LAST, id', [userId, date]),
    pool.query('SELECT * FROM expenses WHERE user_id=$1 AND expense_date=$2 ORDER BY id DESC', [userId, date]),
    pool.query('SELECT * FROM budgets WHERE user_id=$1 AND budget_date=$2', [userId, date]),
    getScoringWeights(userId),
  ]);

  const totalSpent = expenses.rows
    .filter((e) => e.kind === 'expense')
    .reduce((s, e) => s + Number(e.amount), 0);

  const summary = computeDailySummary({
    tasks: tasks.rows,
    workouts: workouts.rows,
    diet: diet.rows,
    schedule: schedule.rows,
    budget: budget.rows[0] || null,
    totalSpent,
    weights,
  });

  return {
    date,
    tasks: tasks.rows,
    workouts: workouts.rows,
    diet: diet.rows,
    schedule: schedule.rows,
    expenses: expenses.rows,
    budget: budget.rows[0] || null,
    totalSpent,
    summary,
  };
}

// One summary per calendar day between start/end (inclusive), cheap enough
// for a single-user personal tracker's history.
async function getRangeSummaries(userId, start, end) {
  const [tasksR, workoutsR, dietR, scheduleR, expensesR, budgetsR, weights] = await Promise.all([
    pool.query('SELECT * FROM tasks WHERE user_id=$1 AND task_date BETWEEN $2 AND $3', [userId, start, end]),
    pool.query('SELECT * FROM workouts WHERE user_id=$1 AND workout_date BETWEEN $2 AND $3', [userId, start, end]),
    pool.query('SELECT * FROM diet_entries WHERE user_id=$1 AND entry_date BETWEEN $2 AND $3', [userId, start, end]),
    pool.query('SELECT * FROM schedule_items WHERE user_id=$1 AND item_date BETWEEN $2 AND $3', [userId, start, end]),
    pool.query('SELECT * FROM expenses WHERE user_id=$1 AND expense_date BETWEEN $2 AND $3', [userId, start, end]),
    pool.query('SELECT * FROM budgets WHERE user_id=$1 AND budget_date BETWEEN $2 AND $3', [userId, start, end]),
    getScoringWeights(userId),
  ]);

  const groupByDate = (rows, dateKey) => {
    const map = {};
    for (const r of rows) {
      const key = toDateKey(r[dateKey]);
      if (key) (map[key] = map[key] || []).push(r);
    }
    return map;
  };

  const tasksByDate = groupByDate(tasksR.rows, 'task_date');
  const workoutsByDate = groupByDate(workoutsR.rows, 'workout_date');
  const dietByDate = groupByDate(dietR.rows, 'entry_date');
  const scheduleByDate = groupByDate(scheduleR.rows, 'item_date');
  const expensesByDate = groupByDate(expensesR.rows, 'expense_date');
  const budgetsByDate = {};
  for (const b of budgetsR.rows) {
    const key = toDateKey(b.budget_date);
    if (key) budgetsByDate[key] = b;
  }

  const days = [];
  let cursor = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  while (cursor <= endDate) {
    const dateStr = toDateKey(cursor);
    const dayExpenses = expensesByDate[dateStr] || [];
    const totalSpent = dayExpenses
      .filter((e) => e.kind === 'expense')
      .reduce((s, e) => s + Number(e.amount), 0);

    const summary = computeDailySummary({
      tasks: tasksByDate[dateStr] || [],
      workouts: workoutsByDate[dateStr] || [],
      diet: dietByDate[dateStr] || [],
      schedule: scheduleByDate[dateStr] || [],
      budget: budgetsByDate[dateStr] || null,
      totalSpent,
      weights,
    });

    days.push({ date: dateStr, ...summary });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

module.exports = { getDay, getRangeSummaries, getScoringWeights, todayStr };
