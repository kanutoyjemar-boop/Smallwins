// Pure helpers for backup import: validate + normalize a SelfUp export so the
// route can insert it safely. No database access here, so it's unit-testable.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

function asDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.slice(0, 10);
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
function asText(v, max = 200) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}
function asInt(v, fallback = null, min = 0, max = 1000000) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
function asMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? Math.round(n * 100) / 100 : null;
}
function list(v) { return Array.isArray(v) ? v : []; }

const SECTIONS = {
  tasks(r) {
    const task_date = asDate(r.task_date), title = asText(r.title, 140);
    if (!task_date || !title || !['AM', 'PM'].includes(r.period)) return null;
    return { task_date, period: r.period, title, done: Boolean(r.done), points: asInt(r.points, 10, 1, 1000) };
  },
  expenses(r) {
    const expense_date = asDate(r.expense_date), title = asText(r.title, 140), amount = asMoney(r.amount);
    if (!expense_date || !title || amount === null) return null;
    return { expense_date, title, category: asText(r.category, 60) || 'other', amount, kind: r.kind === 'income' ? 'income' : 'expense' };
  },
  budgets(r) {
    const budget_date = asDate(r.budget_date), daily_limit = asMoney(r.daily_limit);
    if (!budget_date || daily_limit === null) return null;
    return { budget_date, daily_limit };
  },
  workouts(r) {
    const workout_date = asDate(r.workout_date), activity_type = asText(r.activity_type, 80);
    if (!workout_date || !activity_type) return null;
    return { workout_date, activity_type, duration_minutes: asInt(r.duration_minutes, 0, 0, 10000), notes: asText(r.notes, 160), done: Boolean(r.done), points: asInt(r.points, 20, 1, 1000) };
  },
  diet(r) {
    const entry_date = asDate(r.entry_date), food = asText(r.food, 160);
    if (!entry_date || !food) return null;
    return { entry_date, meal_label: asText(r.meal_label, 40) || 'Meal', food, calories: asInt(r.calories, null, 0, 100000), eaten: Boolean(r.eaten), points: asInt(r.points, 10, 1, 1000) };
  },
  schedule(r) {
    const item_date = asDate(r.item_date), title = asText(r.title, 140);
    if (!item_date || !title) return null;
    const status = ['pending', 'done', 'overtime', 'skipped'].includes(r.status) ? r.status : 'pending';
    return {
      item_date, title, location: asText(r.location, 140),
      start_time: typeof r.start_time === 'string' && TIME_RE.test(r.start_time) ? r.start_time : null,
      planned_minutes: asInt(r.planned_minutes, 30, 1, 10000), actual_minutes: asInt(r.actual_minutes, null, 0, 10000),
      status, points: asInt(r.points, 10, 1, 1000),
    };
  },
  goals(r) {
    const goal_date = asDate(r.goal_date), title = asText(r.title, 140);
    if (!goal_date || !title) return null;
    const target = asInt(r.target, 1, 1, 100000), progress = asInt(r.progress, 0, 0, 1000000);
    return { goal_date, title, target, progress, unit: asText(r.unit, 30) || 'times', completed: Boolean(r.completed) || progress >= target };
  },
  reflections(r) {
    const entry_date = asDate(r.entry_date);
    if (!entry_date) return null;
    const mood = ['steady', 'great', 'tired', 'overwhelmed'].includes(r.mood) ? r.mood : 'steady';
    return { entry_date, mood, wins: asText(r.wins, 1000), note: asText(r.note, 2000) };
  },
  routines(r) {
    const name = asText(r.name, 100);
    if (!name || !['tasks', 'workouts', 'schedule'].includes(r.kind) || !Array.isArray(r.items) || !r.items.length) return null;
    return { name, kind: r.kind, items: r.items.slice(0, 100).filter((i) => i && typeof i === 'object') };
  },
  milestones(r) {
    const milestone_key = asText(r.milestone_key, 80), label = asText(r.label, 120);
    if (!milestone_key || !label) return null;
    const t = typeof r.achieved_at === 'string' ? new Date(r.achieved_at) : null;
    return { milestone_key, label, achieved_at: t && !Number.isNaN(t.getTime()) ? t.toISOString() : null };
  },
};

// Returns { data: {section: [rows]}, accepted: n, skipped: n }.
function normalizeBackup(payload) {
  const data = {};
  let accepted = 0, skipped = 0;
  const src = payload && typeof payload === 'object' ? payload : {};
  for (const [name, fn] of Object.entries(SECTIONS)) {
    data[name] = [];
    for (const row of list(src[name]).slice(0, 50000)) {
      const clean = row && typeof row === 'object' ? fn(row) : null;
      if (clean) { data[name].push(clean); accepted++; } else { skipped++; }
    }
  }
  return { data, accepted, skipped };
}

module.exports = { normalizeBackup, asDate };
