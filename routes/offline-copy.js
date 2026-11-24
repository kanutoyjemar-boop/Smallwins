const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const userId = req.userId;
  const q = (sql) => pool.query(sql, [userId]).then((result) => result.rows);
  const [
    account, tasks, expenses, budgets, monthlyAllowances, recurringBills, billOccurrences,
    savingsFunds, savingsEntries, recovery, workouts, diet, schedule, goals, reflections,
    weeklyPlans, focusCheckins, scoringPreferences, templates, milestones, recurringTasks,
  ] = await Promise.all([
    pool.query(
      'SELECT id, name, username, email, avatar_data AS avatar, created_at FROM users WHERE id = $1',
      [userId]
    ),
    q(`SELECT id, to_char(task_date, 'YYYY-MM-DD') AS task_date, period, title, done, points
         FROM tasks WHERE user_id = $1 ORDER BY task_date, period, id`),
    q(`SELECT e.id, to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date, e.title, e.category, e.amount, e.kind,
              b.export_key::text AS bill_key, to_char(e.bill_month, 'YYYY-MM-DD') AS bill_month
         FROM expenses e LEFT JOIN recurring_bills b ON b.id = e.recurring_bill_id
        WHERE e.user_id = $1 ORDER BY e.expense_date, e.id`),
    q(`SELECT id, to_char(budget_date, 'YYYY-MM-DD') AS budget_date, daily_limit
         FROM budgets WHERE user_id = $1 ORDER BY budget_date`),
    q(`SELECT id, to_char(allowance_month, 'YYYY-MM-DD') AS allowance_month, amount
         FROM monthly_allowances WHERE user_id = $1 ORDER BY allowance_month`),
    q(`SELECT id, export_key::text AS export_key, to_char(start_month, 'YYYY-MM-DD') AS start_month,
              title, category, amount, due_day, status
         FROM recurring_bills WHERE user_id = $1 ORDER BY id`),
    q(`SELECT o.id, o.bill_id, b.export_key::text AS bill_key,
              to_char(o.bill_month, 'YYYY-MM-DD') AS bill_month,
              to_char(o.due_date, 'YYYY-MM-DD') AS due_date, o.title, o.category, o.amount,
              o.status, o.paid_at, o.expense_id
         FROM bill_occurrences o JOIN recurring_bills b ON b.id = o.bill_id
        WHERE o.user_id = $1 ORDER BY o.bill_month, o.due_date, o.id`),
    q(`SELECT id, export_key::text AS export_key, title, target_amount, status,
              to_char(created_at, 'YYYY-MM-DD') AS created_date
         FROM savings_funds WHERE user_id = $1 ORDER BY id`),
    q(`SELECT e.id, e.fund_id, e.export_key::text AS export_key, f.export_key::text AS fund_key,
              to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.kind, e.amount
         FROM savings_fund_entries e JOIN savings_funds f ON f.id = e.fund_id
        WHERE e.user_id = $1 ORDER BY e.entry_date, e.id`),
    q(`SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, sleep_hours, sleep_quality, energy, stress, note
         FROM recovery_checkins WHERE user_id = $1 ORDER BY entry_date`),
    q(`SELECT id, to_char(workout_date, 'YYYY-MM-DD') AS workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, done, points
         FROM workouts WHERE user_id = $1 ORDER BY workout_date, id`),
    q(`SELECT id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, meal_label, food, calories, protein_grams, eaten, points
         FROM diet_entries WHERE user_id = $1 ORDER BY entry_date, id`),
    q(`SELECT id, to_char(item_date, 'YYYY-MM-DD') AS item_date, title, location, to_char(start_time, 'HH24:MI:SS') AS start_time,
              planned_minutes, actual_minutes, status, points
         FROM schedule_items WHERE user_id = $1 ORDER BY item_date, id`),
    q(`SELECT id, to_char(goal_date, 'YYYY-MM-DD') AS goal_date, title, target, progress, unit, completed
         FROM focus_goals WHERE user_id = $1 ORDER BY goal_date, id`),
    q(`SELECT id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, mood, wins, note
         FROM daily_reflections WHERE user_id = $1 ORDER BY entry_date`),
    q(`SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, focus, rest_days
         FROM weekly_plans WHERE user_id = $1 ORDER BY week_start`),
    q(`SELECT to_char(check_date, 'YYYY-MM-DD') AS check_date
         FROM weekly_focus_checkins WHERE user_id = $1 ORDER BY check_date`),
    q(`SELECT tasks, workouts, diet, schedule, money
         FROM scoring_preferences WHERE user_id = $1`),
    q(`SELECT id, name, kind, items FROM routine_templates WHERE user_id = $1 ORDER BY id`),
    q(`SELECT id, milestone_key, label, achieved_at
         FROM achievement_milestones WHERE user_id = $1 ORDER BY achieved_at`),
    q(`SELECT id, title, period, points, weekdays,
              to_char(start_date, 'YYYY-MM-DD') AS start_date
         FROM recurring_tasks WHERE user_id = $1 ORDER BY id`),
  ]);

  res.json({
    version: 12,
    exported_at: new Date().toISOString(),
    account: account.rows[0],
    tasks,
    expenses,
    budgets,
    monthly_allowances: monthlyAllowances,
    recurring_bills: recurringBills,
    bill_occurrences: billOccurrences,
    savings_funds: savingsFunds,
    savings_fund_entries: savingsEntries,
    recovery,
    workouts,
    diet,
    schedule,
    goals,
    reflections,
    weekly_plans: weeklyPlans,
    weekly_focus_checkins: focusCheckins,
    scoring_preferences: scoringPreferences,
    templates,
    milestones,
    recurring_tasks: recurringTasks,
  });
});

module.exports = router;
