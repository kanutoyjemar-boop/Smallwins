const cron = require('node-cron');
const { pool } = require('../db');
const push = require('./push');
const { getDay } = require('./summaries');
const { computeStreak } = require('./streaks');
const { pushMessage } = require('./motivation');
const logger = require('./logger');
const { addDays } = require('./date');

const REMINDERS = [
  { type: 'morning', enabled: 'morning_enabled', time: 'morning_time' },
  { type: 'evening', enabled: 'evening_enabled', time: 'evening_time' },
  { type: 'streak', enabled: 'streak_enabled', time: 'streak_time' },
];
const LOCK_ID = 741206;

function localDateTime(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function minuteOfDay(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

function dueWithinRecoveryWindow(currentTime, scheduledTime, minutes = 10) {
  const overdue = minuteOfDay(currentTime) - minuteOfDay(scheduledTime);
  return overdue >= 0 && overdue <= minutes;
}

async function claimDelivery(database, userId, type, localDate) {
  const { rows } = await database.query(
    `INSERT INTO notification_deliveries
       (user_id, reminder_type, local_date, status, attempts)
     VALUES ($1, $2, $3, 'sending', 1)
     ON CONFLICT (user_id, reminder_type, local_date) DO UPDATE SET
       status = 'sending',
       attempts = notification_deliveries.attempts + 1,
       updated_at = now()
     WHERE notification_deliveries.status IN ('failed', 'sending')
       AND notification_deliveries.updated_at < now() - interval '5 minutes'
     RETURNING id`,
    [userId, type, localDate]
  );
  return rows[0]?.id || null;
}

async function setDeliveryStatus(database, id, status) {
  await database.query(
    `UPDATE notification_deliveries
     SET status = $2, updated_at = now(),
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
     WHERE id = $1`,
    [id, status]
  );
}

async function getBillsDue(database, userId, dueDate) {
  const { rows } = await database.query(
    `SELECT b.id, b.title, b.amount
       FROM recurring_bills b
       LEFT JOIN bill_occurrences o
         ON o.user_id = b.user_id AND o.bill_id = b.id
        AND o.bill_month = date_trunc('month', $2::date)::date
      WHERE b.user_id = $1
        AND b.start_month <= date_trunc('month', $2::date)::date
        AND ((o.id IS NULL AND b.status = 'active') OR o.status = 'unpaid')
        AND LEAST(
              b.due_day,
              EXTRACT(DAY FROM (date_trunc('month', $2::date) + interval '1 month - 1 day'))::int
            ) = EXTRACT(DAY FROM $2::date)
      ORDER BY b.due_day, b.id`,
    [userId, dueDate]
  );
  return rows;
}

async function getCashflowBalance(database, userId, date) {
  const { rows } = await database.query(
    `WITH period AS (SELECT date_trunc('month', $2::date)::date AS month_start)
     SELECT
       (SELECT amount FROM monthly_allowances
         WHERE user_id = $1 AND allowance_month <= period.month_start
         ORDER BY allowance_month DESC LIMIT 1) AS allowance,
       COALESCE((SELECT SUM(amount) FILTER (WHERE kind = 'income')
                   FROM expenses WHERE user_id = $1
                    AND expense_date >= period.month_start AND expense_date <= $2::date), 0) AS income,
       COALESCE((SELECT SUM(amount) FILTER (WHERE kind = 'expense')
                   FROM expenses WHERE user_id = $1
                    AND expense_date >= period.month_start AND expense_date <= $2::date), 0) AS expenses,
       COALESCE((SELECT SUM(CASE WHEN o.id IS NULL THEN b.amount
                                 WHEN o.status = 'unpaid' THEN o.amount ELSE 0 END)
                   FROM recurring_bills b
                   LEFT JOIN bill_occurrences o
                     ON o.user_id = b.user_id AND o.bill_id = b.id AND o.bill_month = period.month_start
                  WHERE b.user_id = $1
                    AND ((o.id IS NOT NULL AND o.status = 'unpaid')
                      OR (o.id IS NULL AND b.status = 'active' AND b.start_month <= period.month_start))), 0) AS reserved,
       COALESCE((SELECT SUM(amount) FILTER (WHERE kind = 'save')
                   FROM savings_fund_entries
                  WHERE user_id = $1 AND entry_date >= period.month_start AND entry_date <= $2::date), 0) AS saved,
       COALESCE((SELECT SUM(amount) FILTER (WHERE kind = 'withdraw')
                   FROM savings_fund_entries
                  WHERE user_id = $1 AND entry_date >= period.month_start AND entry_date <= $2::date), 0) AS withdrawn
       FROM period`,
    [userId, date]
  );
  const row = rows[0];
  if (!row || row.allowance === null) return null;
  return Number(row.allowance) + Number(row.income) - Number(row.expenses) -
    Number(row.reserved) - Number(row.saved) + Number(row.withdrawn);
}

async function shouldSend(database, userId, type, localDate, localTime, scheduledTime) {
  const previous = await database.query(
    `SELECT status, updated_at FROM notification_deliveries
      WHERE user_id = $1 AND reminder_type = $2 AND local_date = $3`,
    [userId, type, localDate]
  );
  if (previous.rows.length) {
    const delivery = previous.rows[0];
    if (delivery.status === 'sent' || delivery.status === 'skipped') return false;
    if (Date.now() - new Date(delivery.updated_at).getTime() < 5 * 60 * 1000) return false;
    return true;
  }
  return dueWithinRecoveryWindow(localTime, scheduledTime);
}

async function sendCashflowAlert(database, pushClient, userId, type, localDate, payload) {
  const deliveryId = await claimDelivery(database, userId, type, localDate);
  if (!deliveryId) return;
  try {
    const result = await pushClient.sendToUser(userId, payload);
    await setDeliveryStatus(database, deliveryId, result.sent > 0 ? 'sent' : 'skipped');
  } catch (err) {
    await setDeliveryStatus(database, deliveryId, 'failed');
    throw err;
  }
}

async function sendReminder(database, pushClient, setting, reminder, localDate, helpers) {
  const deliveryId = await claimDelivery(database, setting.user_id, reminder.type, localDate);
  if (!deliveryId) return;

  try {
    const day = await helpers.getDayForUser(setting.user_id, localDate);
    if (setting.smart_enabled) {
      if (reminder.type === 'morning'
        && !day.tasks.some((task) => task.period === 'AM' && !task.done)) {
        await setDeliveryStatus(database, deliveryId, 'skipped');
        return;
      }
      if (reminder.type === 'evening' && day.summary.percentage === 100) {
        await setDeliveryStatus(database, deliveryId, 'skipped');
        return;
      }
      if (reminder.type === 'streak'
        && day.summary.percentage !== null && day.summary.percentage >= 60) {
        await setDeliveryStatus(database, deliveryId, 'skipped');
        return;
      }
    }

    const streakStats = await helpers.getStreak(setting.user_id);
    const payload = reminder.type === 'morning'
      ? helpers.makePushMessage('morning', {
        summary: day.summary,
        streakStats,
        pendingAm: day.tasks.filter((task) => task.period === 'AM' && !task.done).length,
      })
      : helpers.makePushMessage(reminder.type, { summary: day.summary, streakStats });
    const result = await pushClient.sendToUser(setting.user_id, {
      ...payload,
      url: reminder.type === 'morning' ? '/#/tasks' : '/',
    });

    await setDeliveryStatus(database, deliveryId, result.sent > 0 ? 'sent' : 'skipped');
  } catch (err) {
    await setDeliveryStatus(database, deliveryId, 'failed');
    throw err;
  }
}

function createScheduler({
  database = pool,
  pushClient = push,
  getDayForUser = getDay,
  getStreak = computeStreak,
  makePushMessage = pushMessage,
  getBillsDueForUser = getBillsDue,
  getBalanceForUser = getCashflowBalance,
} = {}) {
  let task = null;
  let activeTick = null;

  async function tick() {
    if (!pushClient.isConfigured()) return;

    const lockClient = await database.connect();
    let lockAcquired = false;
    try {
      const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);
      if (!lockResult.rows[0].locked) return;
      lockAcquired = true;

      const { rows: settingsRows } = await database.query('SELECT * FROM notification_settings');
      const now = new Date();
      for (const setting of settingsRows) {
        let local;
        try {
          local = localDateTime(setting.timezone, now);
        } catch (err) {
          logger.warn('reminder_timezone_invalid', {
            errorName: err.name,
          });
          continue;
        }

        for (const reminder of REMINDERS) {
          if (!setting[reminder.enabled] || local.time < setting[reminder.time]) continue;
          if (!await shouldSend(database, setting.user_id, reminder.type, local.date, local.time, setting[reminder.time])) continue;
          try {
            await sendReminder(database, pushClient, setting, reminder, local.date, {
              getDayForUser,
              getStreak,
              makePushMessage,
            });
          } catch (err) {
            logger.error('reminder_delivery_failed', {
              reminderType: reminder.type,
              errorName: err.name,
              errorCode: err.code,
            });
          }
        }

        if (setting.bill_due_enabled && local.time >= setting.bill_due_time &&
            await shouldSend(database, setting.user_id, 'bill_due', local.date, local.time, setting.bill_due_time)) {
          try {
            const dueDate = addDays(local.date, Number(setting.bill_due_days_before));
            const bills = await getBillsDueForUser(database, setting.user_id, dueDate);
            if (!bills.length) {
              const deliveryId = await claimDelivery(database, setting.user_id, 'bill_due', local.date);
              if (deliveryId) await setDeliveryStatus(database, deliveryId, 'skipped');
            } else {
              const total = bills.reduce((sum, bill) => sum + Number(bill.amount), 0);
              await sendCashflowAlert(database, pushClient, setting.user_id, 'bill_due', local.date, {
                title: bills.length === 1 ? 'Bill due soon' : `${bills.length} bills due soon`,
                body: `${bills.map((bill) => bill.title).join(', ')} · ₱${total.toFixed(2)}`,
                url: '/#/money',
              });
            }
          } catch (err) {
            logger.error('cashflow_alert_delivery_failed', {
              alertType: 'bill_due',
              errorName: err.name,
              errorCode: err.code,
            });
          }
        }

        if (setting.low_balance_enabled && local.time >= setting.low_balance_time &&
            await shouldSend(database, setting.user_id, 'low_balance', local.date, local.time, setting.low_balance_time)) {
          try {
            const balance = await getBalanceForUser(database, setting.user_id, local.date);
            if (balance === null || balance > Number(setting.low_balance_threshold)) {
              const deliveryId = await claimDelivery(database, setting.user_id, 'low_balance', local.date);
              if (deliveryId) await setDeliveryStatus(database, deliveryId, 'skipped');
            } else {
              const monthStart = `${local.date.slice(0, 7)}-01`;
              const previousAlert = await database.query(
                `SELECT 1 FROM notification_deliveries
                  WHERE user_id = $1 AND reminder_type = 'low_balance'
                    AND local_date >= $2 AND status = 'sent' LIMIT 1`,
                [setting.user_id, monthStart]
              );
              if (!previousAlert.rows.length) {
                await sendCashflowAlert(database, pushClient, setting.user_id, 'low_balance', local.date, {
                  title: 'Cash-flow check-in',
                  body: balance < 0
                    ? `Your cash flow is about ₱${(-balance).toFixed(2)} over budget, below your ₱${Number(setting.low_balance_threshold).toFixed(2)} alert threshold.`
                    : `Your available balance is about ₱${balance.toFixed(2)}, at or below your ₱${Number(setting.low_balance_threshold).toFixed(2)} alert threshold.`,
                  url: '/#/money',
                });
              }
            }
          } catch (err) {
            logger.error('cashflow_alert_delivery_failed', {
              alertType: 'low_balance',
              errorName: err.name,
              errorCode: err.code,
            });
          }
        }
      }
    } finally {
      try {
        if (lockAcquired) await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
      } finally {
        lockClient.release();
      }
    }
  }

  function runTick() {
    if (activeTick) return activeTick;
    activeTick = tick()
      .catch((err) => {
        logger.error('reminder_scheduler_tick_failed', { errorName: err.name, errorCode: err.code });
      })
      .finally(() => { activeTick = null; });
    return activeTick;
  }

  return {
    tick,
    start() {
      if (!pushClient.isConfigured()) {
        logger.warn('reminder_scheduler_disabled', { reason: 'push_not_configured' });
        return;
      }
      if (task) return;
      task = cron.schedule('* * * * *', runTick);
      logger.info('reminder_scheduler_started', { interval: 'every_minute' });
    },
    async stop() {
      if (task) {
        task.stop();
        task = null;
      }
      if (activeTick) await activeTick;
    },
  };
}

const scheduler = createScheduler();

module.exports = {
  createScheduler,
  dueWithinRecoveryWindow,
  getBillsDue,
  getCashflowBalance,
  localDateTime,
  start: () => scheduler.start(),
  stop: () => scheduler.stop(),
  tick: () => scheduler.tick(),
};
