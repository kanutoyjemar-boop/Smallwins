const webpush = require('web-push');
const { pool } = require('../db');

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn(
    'Push notifications are disabled: set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env ' +
    '(generate a pair with `npm run vapid`) to enable them.'
  );
}

function isConfigured() {
  return configured;
}

/**
 * Send one payload to every subscription a user has registered (they may
 * have more than one device). Dead subscriptions (410/404) are pruned.
 */
async function sendToUser(userId, payload) {
  if (!configured) return { sent: 0, skipped: true };

  const { rows } = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=$1',
    [userId]
  );

  let sent = 0;
  await Promise.all(rows.map(async (sub) => {
    const subscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]).catch(() => {});
      } else {
        console.error(`Push send failed for subscription ${sub.id}:`, err.message);
      }
    }
  }));

  return { sent, skipped: false };
}

module.exports = { sendToUser, isConfigured };
