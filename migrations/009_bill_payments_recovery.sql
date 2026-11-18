ALTER TABLE recurring_bills
  ADD COLUMN IF NOT EXISTS start_month DATE;

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

INSERT INTO bill_occurrences
  (user_id, bill_id, bill_month, due_date, title, category, amount, status)
SELECT user_id, recurring_bill_id, bill_month, expense_date, title, category, amount, 'unpaid'
  FROM expenses
 WHERE recurring_bill_id IS NOT NULL AND bill_month IS NOT NULL
ON CONFLICT (user_id, bill_id, bill_month) DO NOTHING;

UPDATE recurring_bills b
   SET start_month = COALESCE(
     (SELECT MIN(o.bill_month) FROM bill_occurrences o WHERE o.bill_id = b.id),
     date_trunc('month', CURRENT_DATE)::date
   )
 WHERE start_month IS NULL;

ALTER TABLE recurring_bills
  ALTER COLUMN start_month SET NOT NULL;

DELETE FROM expenses
 WHERE recurring_bill_id IS NOT NULL AND bill_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS recovery_checkins (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date   DATE NOT NULL,
  sleep_hours  NUMERIC(4,2) CHECK (sleep_hours BETWEEN 0 AND 24),
  sleep_quality SMALLINT CHECK (sleep_quality BETWEEN 1 AND 5),
  energy       SMALLINT CHECK (energy BETWEEN 1 AND 5),
  stress       SMALLINT CHECK (stress BETWEEN 1 AND 5),
  note         TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_date)
);
