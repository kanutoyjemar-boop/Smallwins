const { pool } = require('../db');

// Turn due recurring templates into real tasks for `date` (idempotent and race-safe).
async function ensureRecurring(userId, date) {
  await pool.query(
    `WITH due AS (
       SELECT r.id, r.title, r.period, r.points FROM recurring_tasks r
       WHERE r.user_id = $1 AND r.start_date <= $2::date
         AND EXTRACT(DOW FROM $2::date)::int = ANY(r.weekdays)
         AND NOT EXISTS (SELECT 1 FROM recurring_log l WHERE l.recurring_id = r.id AND l.task_date = $2::date)
     ), logged AS (
       INSERT INTO recurring_log (recurring_id, task_date)
       SELECT id, $2::date FROM due ON CONFLICT DO NOTHING RETURNING recurring_id
     )
     INSERT INTO tasks (user_id, task_date, period, title, points)
     SELECT $1, $2::date, d.period, d.title, d.points FROM due d JOIN logged l ON l.recurring_id = d.id`,
    [userId, date]
  );
}
module.exports = { ensureRecurring };
