-- SelfUp schema: gamified personal discipline tracker
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_data   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- To-dos, split into AM / PM so accomplishments roll up per half-day.
CREATE TABLE IF NOT EXISTS tasks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_date   DATE NOT NULL,
  period      TEXT NOT NULL CHECK (period IN ('AM','PM')),
  title       TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  points      INTEGER NOT NULL DEFAULT 10,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, task_date);

-- Money tracker: expenses/income entries + an optional daily budget.
CREATE TABLE IF NOT EXISTS expenses (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_date   DATE NOT NULL,
  title          TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'other',
  amount         NUMERIC(12,2) NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense','income')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date);

CREATE TABLE IF NOT EXISTS budgets (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  budget_date  DATE NOT NULL,
  daily_limit  NUMERIC(12,2) NOT NULL,
  UNIQUE(user_id, budget_date)
);

CREATE TABLE IF NOT EXISTS monthly_allowances (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allowance_month DATE NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (user_id, allowance_month),
  CHECK (EXTRACT(DAY FROM allowance_month) = 1)
);

CREATE TABLE IF NOT EXISTS recurring_bills (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  export_key UUID NOT NULL DEFAULT gen_random_uuid(),
  start_month DATE NOT NULL DEFAULT (date_trunc('month', CURRENT_DATE)::date),
  title      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Bills',
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_day    INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_bills_user_status ON recurring_bills(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_bills_export_key ON recurring_bills(user_id, export_key);
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS recurring_bill_id INTEGER REFERENCES recurring_bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bill_month DATE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_bill_occurrence
  ON expenses(recurring_bill_id, bill_month)
  WHERE recurring_bill_id IS NOT NULL AND bill_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS bill_occurrences (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bill_id    INTEGER NOT NULL REFERENCES recurring_bills(id) ON DELETE CASCADE,
  bill_month DATE NOT NULL CHECK (EXTRACT(DAY FROM bill_month) = 1),
  due_date   DATE NOT NULL,
  title      TEXT NOT NULL,
  category   TEXT NOT NULL,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status     TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  paid_at    TIMESTAMPTZ,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, bill_id, bill_month)
);
CREATE INDEX IF NOT EXISTS idx_bill_occurrences_user_month ON bill_occurrences(user_id, bill_month);

CREATE TABLE IF NOT EXISTS savings_funds (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  export_key    UUID NOT NULL DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_savings_funds_export_key
  ON savings_funds(user_id, export_key);
CREATE INDEX IF NOT EXISTS idx_savings_funds_user_status
  ON savings_funds(user_id, status);

CREATE TABLE IF NOT EXISTS savings_fund_entries (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  export_key UUID NOT NULL DEFAULT gen_random_uuid(),
  fund_id    INTEGER NOT NULL REFERENCES savings_funds(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('save', 'withdraw')),
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_savings_fund_entries_export_key
  ON savings_fund_entries(user_id, export_key);
CREATE INDEX IF NOT EXISTS idx_savings_fund_entries_user_date
  ON savings_fund_entries(user_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_savings_fund_entries_fund
  ON savings_fund_entries(fund_id, entry_date);

CREATE TABLE IF NOT EXISTS recovery_checkins (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date    DATE NOT NULL,
  sleep_hours   NUMERIC(4,2) CHECK (sleep_hours BETWEEN 0 AND 24),
  sleep_quality SMALLINT CHECK (sleep_quality BETWEEN 1 AND 5),
  energy        SMALLINT CHECK (energy BETWEEN 1 AND 5),
  stress        SMALLINT CHECK (stress BETWEEN 1 AND 5),
  note          TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_date)
);

-- Workouts: gym, walk, run, pickleball, or anything else.
CREATE TABLE IF NOT EXISTS workouts (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_date     DATE NOT NULL,
  activity_type    TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  training_split   TEXT,
  distance_km      NUMERIC(8,2),
  steps            INTEGER,
  exercises        JSONB NOT NULL DEFAULT '[]'::jsonb,
  done             BOOLEAN NOT NULL DEFAULT false,
  points           INTEGER NOT NULL DEFAULT 20,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, workout_date);

-- Diet plan: what to eat, per meal, per day.
CREATE TABLE IF NOT EXISTS diet_entries (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL,
  meal_label  TEXT NOT NULL DEFAULT 'Meal',
  food        TEXT NOT NULL,
  calories    INTEGER,
  protein_grams NUMERIC(7,1),
  eaten       BOOLEAN NOT NULL DEFAULT false,
  points      INTEGER NOT NULL DEFAULT 10,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_diet_user_date ON diet_entries(user_id, entry_date);

-- Time management / agenda: where you should be and for how long.
CREATE TABLE IF NOT EXISTS schedule_items (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_date       DATE NOT NULL,
  title           TEXT NOT NULL,
  location        TEXT,
  start_time      TIME,
  planned_minutes INTEGER NOT NULL DEFAULT 30,
  actual_minutes  INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','overtime','skipped')),
  points          INTEGER NOT NULL DEFAULT 10,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedule_user_date ON schedule_items(user_id, item_date);

-- Web push subscriptions, one row per browser/device the user enabled
-- notifications on.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Per-user notification preferences: what to send and when (local time,
-- "HH:MM", evaluated in the user's chosen IANA timezone).
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone            TEXT NOT NULL DEFAULT 'Asia/Manila',
  smart_enabled       BOOLEAN NOT NULL DEFAULT true,
  morning_enabled     BOOLEAN NOT NULL DEFAULT true,
  morning_time        TEXT NOT NULL DEFAULT '07:30',
  evening_enabled     BOOLEAN NOT NULL DEFAULT true,
  evening_time        TEXT NOT NULL DEFAULT '18:30',
  streak_enabled      BOOLEAN NOT NULL DEFAULT true,
  streak_time         TEXT NOT NULL DEFAULT '21:00',
  agenda_enabled      BOOLEAN NOT NULL DEFAULT false,
  agenda_time         TEXT NOT NULL DEFAULT '08:00',
  agenda_advance_enabled BOOLEAN NOT NULL DEFAULT false,
  agenda_advance_days_before SMALLINT NOT NULL DEFAULT 1
    CHECK (agenda_advance_days_before BETWEEN 1 AND 7),
  agenda_advance_time TEXT NOT NULL DEFAULT '18:00',
  bill_due_enabled    BOOLEAN NOT NULL DEFAULT false,
  bill_due_days_before SMALLINT NOT NULL DEFAULT 1 CHECK (bill_due_days_before BETWEEN 0 AND 7),
  bill_due_time       TEXT NOT NULL DEFAULT '08:00',
  low_balance_enabled BOOLEAN NOT NULL DEFAULT false,
  low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (low_balance_threshold >= 0),
  low_balance_time    TEXT NOT NULL DEFAULT '20:00',
  last_morning_sent   DATE,
  last_evening_sent   DATE,
  last_streak_sent    DATE
);
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS smart_enabled BOOLEAN NOT NULL DEFAULT true;

-- Personal growth layer: weekly focus goals and daily reflections to keep
-- the system useful beyond raw logging.
CREATE TABLE IF NOT EXISTS focus_goals (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_date   DATE NOT NULL,
  title       TEXT NOT NULL,
  target      INTEGER NOT NULL DEFAULT 1,
  progress    INTEGER NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'times',
  completed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_focus_goals_user_date ON focus_goals(user_id, goal_date);

CREATE TABLE IF NOT EXISTS daily_reflections (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL,
  mood        TEXT NOT NULL DEFAULT 'steady',
  wins        TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_date)
);
CREATE INDEX IF NOT EXISTS idx_reflections_user_date ON daily_reflections(user_id, entry_date);

CREATE TABLE IF NOT EXISTS weekly_plans (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  focus      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

CREATE TABLE IF NOT EXISTS weekly_focus_checkins (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_date DATE NOT NULL,
  PRIMARY KEY (user_id, check_date)
);

CREATE TABLE IF NOT EXISTS scoring_preferences (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tasks     INTEGER NOT NULL DEFAULT 1 CHECK (tasks BETWEEN 0 AND 3),
  workouts  INTEGER NOT NULL DEFAULT 1 CHECK (workouts BETWEEN 0 AND 3),
  diet      INTEGER NOT NULL DEFAULT 1 CHECK (diet BETWEEN 0 AND 3),
  schedule  INTEGER NOT NULL DEFAULT 1 CHECK (schedule BETWEEN 0 AND 3),
  money     INTEGER NOT NULL DEFAULT 1 CHECK (money BETWEEN 0 AND 3),
  CHECK (tasks + workouts + diet + schedule + money > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routine_templates (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('tasks','workouts','schedule')),
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_routines_user_kind ON routine_templates(user_id, kind);

CREATE TABLE IF NOT EXISTS achievement_milestones (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_key TEXT NOT NULL,
  label         TEXT NOT NULL,
  achieved_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone_key)
);

-- Recurring tasks: a template that is turned into a normal task on each matching day.
CREATE TABLE IF NOT EXISTS recurring_tasks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  period      TEXT NOT NULL CHECK (period IN ('AM','PM')),
  points      INTEGER NOT NULL DEFAULT 10,
  weekdays    INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',  -- 0 = Sunday
  start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_tasks(user_id);

-- Remembers which days were already generated, so a task you delete on purpose never comes back.
CREATE TABLE IF NOT EXISTS recurring_log (
  recurring_id INTEGER NOT NULL REFERENCES recurring_tasks(id) ON DELETE CASCADE,
  task_date    DATE NOT NULL,
  PRIMARY KEY (recurring_id, task_date)
);
