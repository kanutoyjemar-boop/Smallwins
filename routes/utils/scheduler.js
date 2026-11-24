// Runs inside the same process as the web server (fine for a single-
// instance deploy like Railway). Every minute it checks each user's
// reminder times against "now" in their chosen timezone, and fires at
// most one push per kind per user per day.

const cron = require('node-cron');
const { pool } = require('../db');
const push = require('./push');
const { getDay, todayStr } = require('./summaries');
const { computeStreak } = require('./streaks');
const { pushMessage } = require('./motivation');

function currentHHMM(timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date());
  } catch {
    // Bad/unknown timezone saved somehow — fall back to server time rather
    // than crashing the whole tick.
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  }
}

async function tick() {
  if (!push.isConfigured()) return;

  const { rows: settingsRows } = await pool.query('SELECT * FROM notification_settings');
  const today = todayStr();

  for (const s of settingsRows) {
    const nowHHMM = currentHHMM(s.timezone);
    try {
      if (s.morning_enabled && s.morning_time === nowHHMM && s.last_morning_sent !== today) {
        await sendMorning(s, today);
      }
      if (s.evening_enabled && s.evening_time === nowHHMM && s.last_evening_sent !== today) {
        await sendEvening(s, today);
      }
      if (s.streak_enabled && s.streak_time === nowHHMM && s.last_streak_sent !== today) {
        await sendStreakCheck(s, today);
      }
    } catch (err) {
      console.error(`Notification tick failed for user ${s.user_id}:`, err);
    }
  }
}

async function sendMorning(s, today) {
  const day = await getDay(s.user_id, today);
  if (s.smart_enabled && !day.tasks.some((task) => task.period === 'AM' && !task.done)) return;
  const streakStats = await computeStreak(s.user_id);
  const pendingAm = day.tasks.filter((t) => t.period === 'AM' && !t.done).length;
  const payload = pushMessage('morning', { summary: day.summary, streakStats, pendingAm });
  await push.sendToUser(s.user_id, { ...payload, url: '/#/tasks' });
  await pool.query('UPDATE notification_settings SET last_morning_sent=$2 WHERE user_id=$1', [s.user_id, today]);
}

async function sendEvening(s, today) {
  const day = await getDay(s.user_id, today);
  if (s.smart_enabled && day.summary.percentage === 100) return;
  const streakStats = await computeStreak(s.user_id);
  const payload = pushMessage('evening', { summary: day.summary, streakStats });
  await push.sendToUser(s.user_id, { ...payload, url: '/' });
  await pool.query('UPDATE notification_settings SET last_evening_sent=$2 WHERE user_id=$1', [s.user_id, today]);
}

async function sendStreakCheck(s, today) {
  const day = await getDay(s.user_id, today);
  if (s.smart_enabled && day.summary.percentage !== null && day.summary.percentage >= 60) return;
  const streakStats = await computeStreak(s.user_id);
  const payload = pushMessage('streak', { summary: day.summary, streakStats });
  await push.sendToUser(s.user_id, { ...payload, url: '/' });
  await pool.query('UPDATE notification_settings SET last_streak_sent=$2 WHERE user_id=$1', [s.user_id, today]);
}

function start() {
  if (!push.isConfigured()) {
    console.warn('Reminder scheduler not started: push notifications are not configured.');
    return;
  }
  cron.schedule('* * * * *', () => {
    tick().catch((err) => console.error('Notification scheduler tick error:', err));
  });
  console.log('Reminder scheduler started (checks every minute).');
}

module.exports = { start };
