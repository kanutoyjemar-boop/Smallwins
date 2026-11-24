ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS agenda_advance_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agenda_advance_days_before SMALLINT NOT NULL DEFAULT 1
    CHECK (agenda_advance_days_before BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS agenda_advance_time TEXT NOT NULL DEFAULT '18:00';

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_reminder_type_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_reminder_type_check
  CHECK (reminder_type IN (
    'morning', 'evening', 'streak', 'bill_due', 'low_balance', 'agenda', 'agenda_advance'
  ));
