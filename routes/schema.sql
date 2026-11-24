-- SelfUp schema: gamified personal discipline tracker
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
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

-- Workouts: gym, walk, run, pickleball, or anything else.
CREATE TABLE IF NOT EXISTS workouts (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_date     DATE NOT NULL,
  activity_type    TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
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
