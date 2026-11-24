const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const push = require('../utils/push');
const { getDay, todayStr } = require('../utils/summaries');
const { computeStreak } = require('../utils/streaks');
const { pushMessage } = require('../utils/motivation');

const router = express.Router();

// Public: the frontend needs this to call pushManager.subscribe().
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null, configured: push.isConfigured() });
});

router.use(requireAuth);

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET current notification preferences (creates defaults on first read).
router.get('/settings', async (req, res) => {
  const userId = req.userId;
  let { rows } = await pool.query('SELECT * FROM notification_settings WHERE user_id=$1', [userId]);
  if (!rows.length) {
    const inserted = await pool.query(
      'INSERT INTO notification_settings (user_id) VALUES ($1) RETURNING *',
      [userId]
    );
    rows = inserted.rows;
  }
  const { rows: subRows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE user_id=$1',
    [userId]
  );
  res.json({ settings: rows[0], deviceCount: subRows[0].n, pushConfigured: push.isConfigured() });
});

router.put('/settings', async (req, res) => {
  const userId = req.userId;
  const {
    timezone, smart_enabled, morning_enabled, morning_time,
    evening_enabled, evening_time, streak_enabled, streak_time,
  } = req.body;

  for (const [label, val] of [['morning_time', morning_time], ['evening_time', evening_time], ['streak_time', streak_time]]) {
    if (val !== undefined && !TIME_RE.test(val)) {
      return res.status(400).json({ error: `${label} must be in HH:MM 24-hour format.` });
    }
  }
  if (timezone !== undefined) {
    try { Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch {
      return res.status(400).json({ error: 'Unknown timezone.' });
    }
  }

  await pool.query('INSERT INTO notification_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);

  const { rows } = await pool.query(
    `UPDATE notification_settings SET
       timezone = COALESCE($2, timezone),
       smart_enabled = COALESCE($3, smart_enabled),
       morning_enabled = COALESCE($4, morning_enabled),
       morning_time = COALESCE($5, morning_time),
       evening_enabled = COALESCE($6, evening_enabled),
       evening_time = COALESCE($7, evening_time),
       streak_enabled = COALESCE($8, streak_enabled),
       streak_time = COALESCE($9, streak_time)
     WHERE user_id=$1 RETURNING *`,
     [userId, timezone, smart_enabled, morning_enabled, morning_time, evening_enabled, evening_time, streak_enabled, streak_time]
  );
  res.json({ settings: rows[0] });
});

// Save a browser's PushSubscription so the server can reach this device.
router.post('/subscribe', async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Invalid push subscription.' });
  }
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth`,
    [req.userId, endpoint, keys.p256dh, keys.auth]
  );
  await pool.query('INSERT INTO notification_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.userId]);
  res.status(201).json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2', [req.userId, endpoint]);
  } else {
    await pool.query('DELETE FROM push_subscriptions WHERE user_id=$1', [req.userId]);
  }
  res.json({ ok: true });
});

// Lets a user confirm notifications actually work on their phone before
// relying on the scheduled reminders.
router.post('/test', async (req, res) => {
  if (!push.isConfigured()) {
    return res.status(400).json({ error: 'Push notifications are not configured on this server yet.' });
  }
  const day = await getDay(req.userId, todayStr());
  const streakStats = await computeStreak(req.userId);
  const payload = pushMessage('streak', { summary: day.summary, streakStats });
  const result = await push.sendToUser(req.userId, {
    title: 'SelfUp — Test notification',
    body: "If you can see this, your reminders are wired up correctly. " + payload.body,
    url: '/',
  });
  if (result.sent === 0) return res.status(400).json({ error: 'No active subscriptions on this device.' });
  res.json({ ok: true, sent: result.sent });
});

module.exports = router;
