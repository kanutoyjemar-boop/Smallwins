const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { todayKey } = require('../utils/date');

const router = express.Router();
router.use(requireAuth);

const EXPORT_VERSION = 10;

// GET /api/export -> every row the user has ever logged, as one JSON file.
// Meant for personal backup/portability, not as a general-purpose API.
// DATE columns are formatted in SQL so they come out as plain YYYY-MM-DD
// strings regardless of the server's timezone.
router.get('/', async (req, res) => {
  const userId = req.userId;
  const q = (sql) => pool.query(sql, [userId]).then((r) => r.rows);
  const [user, tasks, expenses, budgets, monthlyAllowances, recurringBills, billOccurrences, savingsFunds, savingsEntries, recovery, workouts, diet, schedule, goals, reflections, weeklyPlans, focusCheckins, scoringPreferences, templates, milestones] = await Promise.all([
    pool.query('SELECT id, name, username, email, created_at FROM users WHERE id = $1', [userId]),
    q(`SELECT to_char(task_date, 'YYYY-MM-DD') AS task_date, period, title, done, points
         FROM tasks WHERE user_id = $1 ORDER BY task_date, period, id`),
    q(`SELECT to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date, e.title, e.category, e.amount, e.kind,
              b.export_key::text AS bill_key, to_char(e.bill_month, 'YYYY-MM-DD') AS bill_month
         FROM expenses e LEFT JOIN recurring_bills b ON b.id = e.recurring_bill_id
        WHERE e.user_id = $1 ORDER BY e.expense_date, e.id`),
    q(`SELECT to_char(budget_date, 'YYYY-MM-DD') AS budget_date, daily_limit
         FROM budgets WHERE user_id = $1 ORDER BY budget_date`),
    q(`SELECT to_char(allowance_month, 'YYYY-MM-DD') AS allowance_month, amount
         FROM monthly_allowances WHERE user_id = $1 ORDER BY allowance_month`),
    q(`SELECT export_key::text AS export_key, to_char(start_month, 'YYYY-MM-DD') AS start_month,
              title, category, amount, due_day, status
         FROM recurring_bills WHERE user_id = $1 ORDER BY id`),
    q(`SELECT b.export_key::text AS bill_key, to_char(o.bill_month, 'YYYY-MM-DD') AS bill_month,
              to_char(o.due_date, 'YYYY-MM-DD') AS due_date, o.title, o.category, o.amount,
              o.status, o.paid_at
         FROM bill_occurrences o JOIN recurring_bills b ON b.id = o.bill_id
        WHERE o.user_id = $1 ORDER BY o.bill_month, o.due_date, o.id`),
    q(`SELECT export_key::text AS export_key, title, target_amount, status
         FROM savings_funds WHERE user_id = $1 ORDER BY id`),
    q(`SELECT e.export_key::text AS export_key, f.export_key::text AS fund_key,
              to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date, e.kind, e.amount
         FROM savings_fund_entries e JOIN savings_funds f ON f.id = e.fund_id
        WHERE e.user_id = $1 ORDER BY e.entry_date, e.id`),
    q(`SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, sleep_hours, sleep_quality, energy, stress, note
         FROM recovery_checkins WHERE user_id = $1 ORDER BY entry_date`),
    q(`SELECT to_char(workout_date, 'YYYY-MM-DD') AS workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, done, points
         FROM workouts WHERE user_id = $1 ORDER BY workout_date, id`),
    q(`SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, meal_label, food, calories, protein_grams, eaten, points
         FROM diet_entries WHERE user_id = $1 ORDER BY entry_date, id`),
    q(`SELECT to_char(item_date, 'YYYY-MM-DD') AS item_date, title, location, to_char(start_time, 'HH24:MI:SS') AS start_time,
              planned_minutes, actual_minutes, status, points
         FROM schedule_items WHERE user_id = $1 ORDER BY item_date, id`),
    q(`SELECT to_char(goal_date, 'YYYY-MM-DD') AS goal_date, title, target, progress, unit, completed
         FROM focus_goals WHERE user_id = $1 ORDER BY goal_date, id`),
    q(`SELECT to_char(entry_date, 'YYYY-MM-DD') AS entry_date, mood, wins, note
         FROM daily_reflections WHERE user_id = $1 ORDER BY entry_date`),
    q(`SELECT to_char(week_start, 'YYYY-MM-DD') AS week_start, focus, rest_days
         FROM weekly_plans WHERE user_id = $1 ORDER BY week_start`),
    q(`SELECT to_char(check_date, 'YYYY-MM-DD') AS check_date
         FROM weekly_focus_checkins WHERE user_id = $1 ORDER BY check_date`),
    q(`SELECT tasks, workouts, diet, schedule, money
         FROM scoring_preferences WHERE user_id = $1`),
    q(`SELECT name, kind, items FROM routine_templates WHERE user_id = $1 ORDER BY id`),
    q(`SELECT milestone_key, label, achieved_at FROM achievement_milestones WHERE user_id = $1 ORDER BY achieved_at`),
  ]);

  res.setHeader('Content-Disposition', `attachment; filename="selfup-export-${todayKey()}.json"`);
  res.json({
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    account: user.rows[0],
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
  });
});

// ---------------------------------------------------------------------------
// Import
//
// Merging is additive and safe to repeat: a row that already exists (same
// natural key) is skipped rather than duplicated, and a malformed row is
// skipped rather than failing the whole backup. Nothing is ever overwritten
// except daily budgets and monthly allowances, which are single values per period.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

const asDate = (v) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const date = v.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
};
const asTime = (v) => {
  if (typeof v !== 'string' || !TIME_RE.test(v)) return null;
  const [hours, minutes, seconds = '0'] = v.split(':').map(Number);
  return hours < 24 && minutes < 60 && seconds < 60 ? v : null;
};
const asStr = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const asNum = (v) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const asInt = (v, fallback = null) => { const n = asNum(v); return n === null ? fallback : Math.round(n); };
const asTimestamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

// Each importer turns one raw backup row into SQL parameters (or null to
// skip it) and says how to insert it without duplicating. $1 is always the user.
const IMPORTERS = [
  {
    key: 'monthly_allowances',
    prepare: (r) => {
      const month = asDate(r.allowance_month), amount = asNum(r.amount);
      return month && month.endsWith('-01') && amount !== null && amount >= 0
        ? [month, amount]
        : null;
    },
    sql: `INSERT INTO monthly_allowances (user_id, allowance_month, amount)
          VALUES ($1::int, $2::date, $3::numeric)
          ON CONFLICT (user_id, allowance_month) DO UPDATE SET amount = EXCLUDED.amount
          WHERE monthly_allowances.amount IS DISTINCT FROM EXCLUDED.amount
          RETURNING (xmax = 0) AS inserted`,
  },
  {
    key: 'recurring_bills',
    prepare: (r) => {
      const key = typeof r.export_key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.export_key)
        ? r.export_key
        : null;
      const title = asStr(r.title, 140), category = asStr(r.category, 60), amount = asNum(r.amount);
      const dueDay = asInt(r.due_day);
      const status = ['active', 'inactive', 'finished'].includes(r.status) ? r.status : null;
      const startMonth = r.start_month == null ? todayKey().slice(0, 7) + '-01' : asDate(r.start_month);
      return key && startMonth && startMonth.endsWith('-01') && title && category && amount !== null && amount > 0 &&
        Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 && status
        ? [key, startMonth, title, category, amount, dueDay, status]
        : null;
    },
    sql: `INSERT INTO recurring_bills (user_id, export_key, start_month, title, category, amount, due_day, status)
          VALUES ($1::int, $2::uuid, $3::date, $4::text, $5::text, $6::numeric, $7::int, $8::text)
          ON CONFLICT (user_id, export_key) DO NOTHING`,
  },
  {
    key: 'savings_funds',
    prepare: (r) => {
      const key = typeof r.export_key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.export_key)
        ? r.export_key
        : null;
      const title = asStr(r.title, 140), target = asNum(r.target_amount);
      const status = ['active', 'paused', 'completed'].includes(r.status) ? r.status : null;
      return key && title && target !== null && target > 0 && target <= 9999999999.99 && status
        ? [key, title, target, status]
        : null;
    },
    sql: `INSERT INTO savings_funds (user_id, export_key, title, target_amount, status)
          VALUES ($1::int, $2::uuid, $3::text, $4::numeric, $5::text)
          ON CONFLICT (user_id, export_key) DO NOTHING`,
  },
  {
    key: 'savings_fund_entries',
    prepare: (r) => {
      const entryKey = typeof r.export_key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.export_key)
        ? r.export_key
        : null;
      const fundKey = typeof r.fund_key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.fund_key)
        ? r.fund_key
        : null;
      const date = asDate(r.entry_date), amount = asNum(r.amount);
      return entryKey && fundKey && date && ['save', 'withdraw'].includes(r.kind) &&
        amount !== null && amount > 0 && amount <= 9999999999.99
        ? [entryKey, fundKey, date, r.kind, amount]
        : null;
    },
    sql: `INSERT INTO savings_fund_entries (user_id, export_key, fund_id, entry_date, kind, amount)
          SELECT $1::int, $2::uuid,
                 (SELECT id FROM savings_funds WHERE user_id = $1 AND export_key = $3::uuid),
                 $4::date, $5::text, $6::numeric
          WHERE EXISTS (SELECT 1 FROM savings_funds WHERE user_id = $1 AND export_key = $3::uuid)
          ON CONFLICT (user_id, export_key) DO NOTHING`,
  },
  {
    key: 'recovery',
    prepare: (r) => {
      const date = asDate(r.entry_date);
      const sleepHours = r.sleep_hours == null ? null : asNum(r.sleep_hours);
      const sleepQuality = r.sleep_quality == null ? null : asInt(r.sleep_quality);
      const energy = r.energy == null ? null : asInt(r.energy);
      const stress = r.stress == null ? null : asInt(r.stress);
      const note = typeof r.note === 'string' ? r.note.slice(0, 500) : '';
      if (!date ||
          (r.sleep_hours != null && (sleepHours === null || sleepHours < 0 || sleepHours > 24)) ||
          [sleepQuality, energy, stress].some((value) => value !== null && (!Number.isInteger(value) || value < 1 || value > 5))) return null;
      return [date, sleepHours, sleepQuality, energy, stress, note];
    },
    sql: `INSERT INTO recovery_checkins (user_id, entry_date, sleep_hours, sleep_quality, energy, stress, note)
          VALUES ($1::int, $2::date, $3::numeric, $4::smallint, $5::smallint, $6::smallint, $7::text)
          ON CONFLICT (user_id, entry_date) DO NOTHING`,
  },
  {
    key: 'tasks',
    prepare: (r) => {
      const date = asDate(r.task_date), title = asStr(r.title, 140);
      if (!date || !title || !['AM', 'PM'].includes(r.period)) return null;
      return [date, r.period, title, Boolean(r.done), asInt(r.points, 10)];
    },
    sql: `INSERT INTO tasks (user_id, task_date, period, title, done, points)
          SELECT $1::int, $2::date, $3::text, $4::text, $5::boolean, $6::int
          WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE user_id = $1 AND task_date = $2::date AND period = $3::text AND title = $4::text)`,
  },
  {
    key: 'expenses',
    prepare: (r) => {
      const date = asDate(r.expense_date), title = asStr(r.title, 140), amount = asNum(r.amount);
      if (!date || !title || amount === null) return null;
      const billKey = r.bill_key == null ? null :
        (typeof r.bill_key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.bill_key) ? r.bill_key : null);
      const billMonth = r.bill_month == null ? null : asDate(r.bill_month);
      if ((r.bill_key != null && !billKey) || (r.bill_month != null && (!billMonth || !billKey))) return null;
      return [date, title, asStr(r.category, 60) || 'other', amount, r.kind === 'income' ? 'income' : 'expense', billKey, billMonth];
    },
    sql: `INSERT INTO expenses (user_id, expense_date, title, category, amount, kind, recurring_bill_id, bill_month)
          SELECT $1::int, $2::date, $3::text, $4::text, $5::numeric, $6::text,
                 (SELECT id FROM recurring_bills WHERE user_id = $1 AND export_key = $7::uuid), $8::date
          WHERE NOT EXISTS (
            SELECT 1 FROM expenses
             WHERE user_id = $1
               AND (
                 ($7::uuid IS NOT NULL AND recurring_bill_id =
                   (SELECT id FROM recurring_bills WHERE user_id = $1 AND export_key = $7::uuid)
                   AND bill_month = $8::date)
                 OR
                 ($7::uuid IS NULL AND expense_date = $2::date AND title = $3::text
                   AND amount = $5::numeric AND kind = $6::text
                   AND recurring_bill_id IS NULL AND bill_month IS NULL)
               )
          )`,
  },
  {
    key: 'bill_occurrences',
    prepare: (r) => {
      const billKey = typeof r.bill_key === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.bill_key) ? r.bill_key : null;
      const month = asDate(r.bill_month), dueDate = asDate(r.due_date);
      const title = asStr(r.title, 140), category = asStr(r.category, 60), amount = asNum(r.amount);
      const status = ['unpaid', 'paid'].includes(r.status) ? r.status : null;
      const paidAt = status === 'paid' ? asTimestamp(r.paid_at) : null;
      return billKey && month && month.endsWith('-01') && dueDate && title && category &&
        amount !== null && amount > 0 && status && (status !== 'paid' || paidAt)
        ? [billKey, month, dueDate, title, category, amount, status, paidAt]
        : null;
    },
    sql: `INSERT INTO bill_occurrences
            (user_id, bill_id, bill_month, due_date, title, category, amount, status, paid_at, expense_id)
          SELECT $1::int,
                 (SELECT id FROM recurring_bills WHERE user_id = $1 AND export_key = $2::uuid),
                 $3::date, $4::date, $5::text, $6::text, $7::numeric, $8::text, $9::timestamptz,
                 (SELECT e.id FROM expenses e
                    JOIN recurring_bills b ON b.id = e.recurring_bill_id
                   WHERE e.user_id = $1 AND b.export_key = $2::uuid AND e.bill_month = $3::date)
          WHERE EXISTS (SELECT 1 FROM recurring_bills WHERE user_id = $1 AND export_key = $2::uuid)
            AND ($8::text = 'unpaid' OR EXISTS (
              SELECT 1 FROM expenses e JOIN recurring_bills b ON b.id = e.recurring_bill_id
               WHERE e.user_id = $1 AND b.export_key = $2::uuid AND e.bill_month = $3::date
            ))
          ON CONFLICT (user_id, bill_id, bill_month) DO NOTHING`,
  },
  {
    key: 'budgets',
    prepare: (r) => {
      const date = asDate(r.budget_date), limit = asNum(r.daily_limit);
      return date && limit !== null && limit >= 0 ? [date, limit] : null;
    },
    sql: `INSERT INTO budgets (user_id, budget_date, daily_limit) VALUES ($1::int, $2::date, $3::numeric)
          ON CONFLICT (user_id, budget_date) DO UPDATE SET daily_limit = EXCLUDED.daily_limit
          WHERE budgets.daily_limit IS DISTINCT FROM EXCLUDED.daily_limit
          RETURNING (xmax = 0) AS inserted`,
  },
  {
    key: 'workouts',
    prepare: (r) => {
      const date = asDate(r.workout_date), type = asStr(r.activity_type, 80);
      if (!date || !type) return null;
      const distance = r.distance_km == null ? null : asNum(r.distance_km);
      const steps = r.steps == null ? null : asNum(r.steps);
      const exercises = r.exercises == null ? [] : r.exercises;
      if ((r.distance_km != null && (distance === null || distance < 0 || distance > 999999.99)) ||
          (r.steps != null && (steps === null || !Number.isInteger(steps) || steps < 0 || steps > 1000000)) ||
          !Array.isArray(exercises) || exercises.length > 30 ||
          !exercises.every((exercise) => exercise && typeof exercise.name === 'string' && exercise.name.trim().length > 0 && exercise.name.length <= 80 &&
            Number.isInteger(exercise.sets) && exercise.sets >= 1 && exercise.sets <= 100 &&
            Number.isInteger(exercise.reps) && exercise.reps >= 1 && exercise.reps <= 1000 &&
            (exercise.weight_kg == null || (Number.isFinite(exercise.weight_kg) && exercise.weight_kg >= 0 && exercise.weight_kg <= 1000)))) return null;
      return [date, type, asInt(r.duration_minutes, 0), asStr(r.notes, 160), asStr(r.training_split, 40), distance, steps, exercises, Boolean(r.done), asInt(r.points, 20)];
    },
    sql: `INSERT INTO workouts (user_id, workout_date, activity_type, duration_minutes, notes, training_split, distance_km, steps, exercises, done, points)
          SELECT $1::int, $2::date, $3::text, $4::int, $5::text, $6::text, $7::numeric, $8::integer, $9::jsonb, $10::boolean, $11::int
          WHERE NOT EXISTS (SELECT 1 FROM workouts WHERE user_id = $1 AND workout_date = $2::date AND activity_type = $3::text AND duration_minutes = $4::int AND exercises IS NOT DISTINCT FROM $9::jsonb)`,
  },
  {
    key: 'diet',
    prepare: (r) => {
      const date = asDate(r.entry_date), food = asStr(r.food, 160);
      if (!date || !food) return null;
      const protein = r.protein_grams == null ? null : asNum(r.protein_grams);
      if (r.protein_grams != null && (protein === null || protein < 0 || protein > 1000)) return null;
      return [date, asStr(r.meal_label, 40) || 'Meal', food, asInt(r.calories), protein, Boolean(r.eaten), asInt(r.points, 10)];
    },
    sql: `INSERT INTO diet_entries (user_id, entry_date, meal_label, food, calories, protein_grams, eaten, points)
          SELECT $1::int, $2::date, $3::text, $4::text, $5::int, $6::numeric, $7::boolean, $8::int
          WHERE NOT EXISTS (SELECT 1 FROM diet_entries WHERE user_id = $1 AND entry_date = $2::date AND meal_label = $3::text AND food = $4::text)`,
  },
  {
    key: 'schedule',
    prepare: (r) => {
      const date = asDate(r.item_date), title = asStr(r.title, 140);
      if (!date || !title) return null;
      const status = ['pending', 'done', 'overtime', 'skipped'].includes(r.status) ? r.status : 'pending';
      return [date, title, asStr(r.location, 120), asTime(r.start_time), Math.max(1, asInt(r.planned_minutes, 30)), asInt(r.actual_minutes), status, asInt(r.points, 10)];
    },
    sql: `INSERT INTO schedule_items (user_id, item_date, title, location, start_time, planned_minutes, actual_minutes, status, points)
          SELECT $1::int, $2::date, $3::text, $4::text, $5::time, $6::int, $7::int, $8::text, $9::int
          WHERE NOT EXISTS (SELECT 1 FROM schedule_items WHERE user_id = $1 AND item_date = $2::date AND title = $3::text AND start_time IS NOT DISTINCT FROM $5::time)`,
  },
  {
    key: 'goals',
    prepare: (r) => {
      const date = asDate(r.goal_date), title = asStr(r.title, 140);
      if (!date || !title) return null;
      const target = Math.max(1, asInt(r.target, 1)), progress = Math.max(0, asInt(r.progress, 0));
      return [date, title, target, progress, asStr(r.unit, 30) || 'times', progress >= target];
    },
    sql: `INSERT INTO focus_goals (user_id, goal_date, title, target, progress, unit, completed)
          SELECT $1::int, $2::date, $3::text, $4::int, $5::int, $6::text, $7::boolean
          WHERE NOT EXISTS (SELECT 1 FROM focus_goals WHERE user_id = $1 AND goal_date = $2::date AND title = $3::text)`,
  },
  {
    key: 'reflections',
    prepare: (r) => {
      const date = asDate(r.entry_date);
      return date ? [date, asStr(r.mood, 30) || 'steady', asStr(r.wins, 1000), asStr(r.note, 2000)] : null;
    },
    sql: `INSERT INTO daily_reflections (user_id, entry_date, mood, wins, note)
          VALUES ($1::int, $2::date, $3::text, $4::text, $5::text)
          ON CONFLICT (user_id, entry_date) DO NOTHING`,
  },
  {
    key: 'weekly_plans',
    prepare: (r) => {
      const weekStart = asDate(r.week_start), focus = typeof r.focus === 'string' ? r.focus.trim().slice(0, 140) : null;
      if (!weekStart || !focus || new Date(`${weekStart}T00:00:00`).getDay() !== 1) return null;
      const restDays = r.rest_days === undefined ? [] : r.rest_days;
      if (!Array.isArray(restDays) || restDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
      return [weekStart, focus, [...new Set(restDays)]];
    },
    sql: `INSERT INTO weekly_plans (user_id, week_start, focus, rest_days)
          VALUES ($1::int, $2::date, $3::text, $4::smallint[])
          ON CONFLICT (user_id, week_start) DO NOTHING`,
  },
  {
    key: 'weekly_focus_checkins',
    prepare: (r) => {
      const date = asDate(r.check_date);
      return date ? [date] : null;
    },
    sql: `INSERT INTO weekly_focus_checkins (user_id, check_date)
          VALUES ($1::int, $2::date) ON CONFLICT (user_id, check_date) DO NOTHING`,
  },
  {
    key: 'scoring_preferences',
    prepare: (r) => {
      const keys = ['tasks', 'workouts', 'diet', 'schedule', 'money'];
      const values = keys.map((key) => asInt(r[key]));
      return values.every((value) => value !== null && value >= 0 && value <= 3) && values.some((value) => value > 0)
        ? values
        : null;
    },
    sql: `INSERT INTO scoring_preferences (user_id, tasks, workouts, diet, schedule, money)
          VALUES ($1::int, $2::int, $3::int, $4::int, $5::int, $6::int)
          ON CONFLICT (user_id) DO NOTHING`,
  },
  {
    key: 'templates',
    prepare: (r) => {
      const name = asStr(r.name, 100);
      if (!name || !['tasks', 'workouts', 'schedule'].includes(r.kind) || !Array.isArray(r.items) || !r.items.length) return null;
      return [name, r.kind, JSON.stringify(r.items)];
    },
    sql: `INSERT INTO routine_templates (user_id, name, kind, items)
          SELECT $1::int, $2::text, $3::text, $4::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM routine_templates WHERE user_id = $1 AND name = $2::text AND kind = $3::text)`,
  },
  {
    key: 'milestones',
    prepare: (r) => {
      const key = asStr(r.milestone_key, 60), label = asStr(r.label, 100);
      return key && label ? [key, label, asTimestamp(r.achieved_at)] : null;
    },
    sql: `INSERT INTO achievement_milestones (user_id, milestone_key, label, achieved_at)
          VALUES ($1::int, $2::text, $3::text, COALESCE($4::timestamptz, now()))
          ON CONFLICT (user_id, milestone_key) DO NOTHING`,
  },
];

const PREVIEW_QUERIES = {
  monthly_allowances: `SELECT amount FROM monthly_allowances WHERE user_id=$1 AND allowance_month=$2::date`,
  recurring_bills: `SELECT EXISTS (SELECT 1 FROM recurring_bills WHERE user_id=$1 AND export_key=$2::uuid) AS already_exists`,
  savings_funds: `SELECT EXISTS (SELECT 1 FROM savings_funds WHERE user_id=$1 AND export_key=$2::uuid) AS already_exists`,
  savings_fund_entries: `SELECT EXISTS (SELECT 1 FROM savings_fund_entries WHERE user_id=$1 AND export_key=$2::uuid) AS already_exists`,
  recovery: `SELECT EXISTS (SELECT 1 FROM recovery_checkins WHERE user_id=$1 AND entry_date=$2::date) AS already_exists`,
  bill_occurrences: `SELECT EXISTS (
    SELECT 1 FROM bill_occurrences o JOIN recurring_bills b ON b.id=o.bill_id
     WHERE o.user_id=$1 AND b.export_key=$2::uuid AND o.bill_month=$3::date
  ) AS already_exists`,
  tasks: `SELECT EXISTS (SELECT 1 FROM tasks WHERE user_id=$1 AND task_date=$2::date AND period=$3::text AND title=$4::text) AS already_exists`,
  expenses: `SELECT EXISTS (
    SELECT 1 FROM expenses
     WHERE user_id=$1 AND (
       ($7::uuid IS NOT NULL AND recurring_bill_id =
         (SELECT id FROM recurring_bills WHERE user_id=$1 AND export_key=$7::uuid) AND bill_month=$8::date)
       OR
       ($7::uuid IS NULL AND expense_date=$2::date AND title=$3::text AND amount=$5::numeric
         AND kind=$6::text AND recurring_bill_id IS NULL AND bill_month IS NULL)
     )
  ) AS already_exists`,
  budgets: `SELECT daily_limit FROM budgets WHERE user_id=$1 AND budget_date=$2::date`,
  workouts: `SELECT EXISTS (
    SELECT 1 FROM workouts
    WHERE user_id=$1 AND workout_date=$2::date AND activity_type=$3::text AND duration_minutes=$4::int
      AND training_split IS NOT DISTINCT FROM $6::text
      AND distance_km IS NOT DISTINCT FROM $7::numeric
      AND steps IS NOT DISTINCT FROM $8::integer
      AND exercises IS NOT DISTINCT FROM $9::jsonb
  ) AS already_exists`,
  diet: `SELECT EXISTS (SELECT 1 FROM diet_entries WHERE user_id=$1 AND entry_date=$2::date AND meal_label=$3::text AND food=$4::text) AS already_exists`,
  schedule: `SELECT EXISTS (SELECT 1 FROM schedule_items WHERE user_id=$1 AND item_date=$2::date AND title=$3::text AND start_time IS NOT DISTINCT FROM $5::time) AS already_exists`,
  goals: `SELECT EXISTS (SELECT 1 FROM focus_goals WHERE user_id=$1 AND goal_date=$2::date AND title=$3::text) AS already_exists`,
  reflections: `SELECT EXISTS (SELECT 1 FROM daily_reflections WHERE user_id=$1 AND entry_date=$2::date) AS already_exists`,
  weekly_plans: `SELECT EXISTS (SELECT 1 FROM weekly_plans WHERE user_id=$1 AND week_start=$2::date) AS already_exists`,
  weekly_focus_checkins: `SELECT EXISTS (SELECT 1 FROM weekly_focus_checkins WHERE user_id=$1 AND check_date=$2::date) AS already_exists`,
  scoring_preferences: 'SELECT EXISTS (SELECT 1 FROM scoring_preferences WHERE user_id=$1) AS already_exists',
  templates: `SELECT EXISTS (SELECT 1 FROM routine_templates WHERE user_id=$1 AND name=$2::text AND kind=$3::text) AS already_exists`,
  milestones: `SELECT EXISTS (SELECT 1 FROM achievement_milestones WHERE user_id=$1 AND milestone_key=$2::text) AS already_exists`,
};

function importRows(payload) {
  const looksValid = payload && typeof payload === 'object' && !Array.isArray(payload)
    && IMPORTERS.some((imp) => Array.isArray(payload[imp.key]));
  if (!looksValid) return null;
  return IMPORTERS.flatMap((imp) => (Array.isArray(payload[imp.key]) ? payload[imp.key] : [])
    .map((raw) => ({ importer: imp, raw })));
}

function previewCategory(importer, counts) {
  return counts[importer.key];
}

function previewParameters(importer, params, userId) {
  const query = PREVIEW_QUERIES[importer.key];
  const placeholders = Array.from(query.matchAll(/\$(\d+)/g), (match) => Number(match[1]));
  const highestPlaceholder = Math.max(...placeholders);
  const keyValues = [...new Set(placeholders.filter((value) => value > 1))]
    .map((value) => params[value - 2]);
  if (importer.key === 'budgets') keyValues.push(params[1]);
  return {
    query,
    queryParams: [userId, ...params.slice(0, highestPlaceholder - 1)],
    keyValues,
  };
}

router.post('/import/preview', async (req, res) => {
  const rows = importRows(req.body);
  if (!rows) return res.status(400).json({ error: 'That file doesn’t look like a SelfUp export.' });
  if (rows.length > 5000) return res.status(413).json({ error: 'Import backups are limited to 5,000 rows.' });

  const counts = Object.fromEntries(IMPORTERS.map((imp) => [
    imp.key,
    { toImport: 0, toOverwrite: 0, alreadyPresent: 0, unreadable: 0 },
  ]));
  const seen = new Set();
  for (const { importer, raw } of rows) {
    const category = previewCategory(importer, counts);
    const params = raw && typeof raw === 'object' && !Array.isArray(raw) ? importer.prepare(raw) : null;
    if (!params) {
      category.unreadable += 1;
      continue;
    }

    const { query, queryParams, keyValues } = previewParameters(importer, params, req.userId);
    const fingerprint = `${importer.key}:${JSON.stringify(keyValues)}`;
    if (seen.has(fingerprint)) {
      category.alreadyPresent += 1;
      continue;
    }
    seen.add(fingerprint);

    const result = await pool.query(query, queryParams);
    if (['budgets', 'monthly_allowances'].includes(importer.key) && result.rows.length) {
      const current = importer.key === 'budgets' ? result.rows[0].daily_limit : result.rows[0].amount;
      if (Number(current) === Number(params[1])) category.alreadyPresent += 1;
      else category.toOverwrite += 1;
    } else if (result.rows[0]?.already_exists) {
      category.alreadyPresent += 1;
    } else {
      category.toImport += 1;
    }
  }

  const totals = Object.values(counts).reduce((total, category) => ({
    toImport: total.toImport + category.toImport,
    toOverwrite: total.toOverwrite + category.toOverwrite,
    alreadyPresent: total.alreadyPresent + category.alreadyPresent,
    unreadable: total.unreadable + category.unreadable,
  }), { toImport: 0, toOverwrite: 0, alreadyPresent: 0, unreadable: 0 });
  res.json({ counts, totals });
});

router.post('/import', async (req, res) => {
  const payload = req.body;
  const allRows = importRows(payload);
  if (!allRows) {
    return res.status(400).json({ error: 'That file doesn\u2019t look like a SelfUp export.' });
  }
  if (allRows.length > 5000) return res.status(413).json({ error: 'Import backups are limited to 5,000 rows.' });

  const imported = {};
  let overwritten = 0;
  let skipped = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const imp of IMPORTERS) {
      imported[imp.key] = 0;
      const rows = Array.isArray(payload[imp.key]) ? payload[imp.key] : [];
      for (const raw of rows) {
        const params = raw && typeof raw === 'object' && !Array.isArray(raw) ? imp.prepare(raw) : null;
        if (!params) { skipped += 1; continue; }
        const result = await client.query(imp.sql, [req.userId, ...params]);
        if (result.rowCount > 0) {
          if (['budgets', 'monthly_allowances'].includes(imp.key) && result.rows[0].inserted === false) overwritten += 1;
          else imported[imp.key] += 1;
        }
        else skipped += 1;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Import failed:', error);
    return res.status(400).json({ error: 'Import failed, so nothing was changed. Check that this is a valid SelfUp export file.' });
  } finally {
    client.release();
  }

  const total = Object.values(imported).reduce((a, b) => a + b, 0);
  res.status(201).json({ ok: true, imported, total, skipped, overwritten });
});

module.exports = router;
