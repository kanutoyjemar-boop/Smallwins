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
  title      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Bills',
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_day    INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_bills_export_key ON recurring_bills(user_id, export_key);
CREATE INDEX IF NOT EXISTS idx_recurring_bills_user_status ON recurring_bills(user_id, status);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS recurring_bill_id INTEGER REFERENCES recurring_bills(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bill_month DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_bill_occurrence
  ON expenses(recurring_bill_id, bill_month)
  WHERE recurring_bill_id IS NOT NULL AND bill_month IS NOT NULL;
