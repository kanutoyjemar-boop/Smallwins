const crypto = require('crypto');
const { pool } = require('../db');

let requestsSinceCleanup = 0;

function requestHash(req) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ method: req.method, path: req.originalUrl, body: req.body }))
    .digest('hex');
}

async function idempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || !['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    return res.status(400).json({ error: 'Invalid idempotency key.' });
  }

  const hash = requestHash(req);
  try {
    const claimed = await pool.query(
      `INSERT INTO idempotency_requests (user_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, idempotency_key) DO UPDATE SET
         request_hash = EXCLUDED.request_hash,
         claimed_at = now(),
         completed_at = NULL,
         response_status = NULL,
         response_body = NULL
       WHERE idempotency_requests.completed_at IS NULL
         AND idempotency_requests.claimed_at < now() - interval '1 minute'
       RETURNING user_id`,
      [req.userId, key, hash]
    );

    if (!claimed.rowCount) {
      const previous = await pool.query(
        `SELECT request_hash, completed_at, response_status, response_body
         FROM idempotency_requests WHERE user_id = $1 AND idempotency_key = $2`,
        [req.userId, key]
      );
      const record = previous.rows[0];
      if (!record) return res.status(409).json({ error: 'Request is already being processed. Try again shortly.' });
      if (record.request_hash !== hash) {
        return res.status(409).json({ error: 'This idempotency key was already used for a different request.' });
      }
      if (record.completed_at) return res.status(record.response_status).json(record.response_body);
      res.set('Retry-After', '2');
      return res.status(409).json({ error: 'Request is already being processed. Try again shortly.' });
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        pool.query(
          'DELETE FROM idempotency_requests WHERE user_id=$1 AND idempotency_key=$2 AND request_hash=$3',
          [req.userId, key, hash]
        ).then(() => originalJson(body)).catch(next);
        return res;
      }
      pool.query(
        `UPDATE idempotency_requests
         SET completed_at=now(), response_status=$3, response_body=$4::jsonb
         WHERE user_id=$1 AND idempotency_key=$2 AND request_hash=$5`,
        [req.userId, key, res.statusCode, JSON.stringify(body), hash]
      ).then(() => {
        requestsSinceCleanup += 1;
        if (requestsSinceCleanup >= 1000) {
          requestsSinceCleanup = 0;
          return pool.query(
            "DELETE FROM idempotency_requests WHERE completed_at < now() - interval '30 days'"
          );
        }
        return null;
      }).then(() => originalJson(body)).catch(next);
      return res;
    };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { idempotency, requestHash };
