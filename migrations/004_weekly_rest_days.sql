ALTER TABLE weekly_plans
  ADD COLUMN IF NOT EXISTS rest_days SMALLINT[] NOT NULL DEFAULT '{}';

ALTER TABLE weekly_plans
  ADD CONSTRAINT weekly_plans_rest_days_valid
  CHECK (rest_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[])
  NOT VALID;

ALTER TABLE weekly_plans
  VALIDATE CONSTRAINT weekly_plans_rest_days_valid;
