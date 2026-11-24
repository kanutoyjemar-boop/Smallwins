ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS agenda_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agenda_time TEXT NOT NULL DEFAULT '08:00';

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_reminder_type_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_reminder_type_check
  CHECK (reminder_type IN ('morning', 'evening', 'streak', 'bill_due', 'low_balance', 'agenda'));
