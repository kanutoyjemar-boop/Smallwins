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

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS bill_due_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bill_due_days_before SMALLINT NOT NULL DEFAULT 1
    CHECK (bill_due_days_before BETWEEN 0 AND 7),
  ADD COLUMN IF NOT EXISTS bill_due_time TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS low_balance_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS low_balance_threshold NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (low_balance_threshold >= 0),
  ADD COLUMN IF NOT EXISTS low_balance_time TEXT NOT NULL DEFAULT '20:00';

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_reminder_type_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_reminder_type_check
  CHECK (reminder_type IN ('morning', 'evening', 'streak', 'bill_due', 'low_balance'));
