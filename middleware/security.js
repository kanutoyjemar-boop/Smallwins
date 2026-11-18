const { pool } = require('../db');
const logger = require('../utils/logger');

// Lightweight security headers and a database-backed limiter shared by app instances.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // The UI sets some style="" attributes, so inline styles stay allowed; scripts do not.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function headers(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  });
  // Only meaningful (and only honoured) over HTTPS; req.secure respects TRUST_PROXY.
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

function rateLimit({
  windowMs = 15 * 60 * 1000,
  max = 10,
  message = 'Too many attempts. Please try again later.',
  database = pool,
} = {}) {
  let requestsSinceCleanup = 0;
  return async (req, res, next) => {
    const bucketKey = `${req.baseUrl}${req.path}:${req.ip}`;
    try {
      const { rows } = await database.query(
        `INSERT INTO api_rate_limits (bucket_key, window_started_at, hit_count)
         VALUES ($1, now(), 1)
         ON CONFLICT (bucket_key) DO UPDATE SET
           window_started_at = CASE
             WHEN api_rate_limits.window_started_at <= now() - ($2::double precision * interval '1 millisecond')
             THEN now() ELSE api_rate_limits.window_started_at END,
           hit_count = CASE
             WHEN api_rate_limits.window_started_at <= now() - ($2::double precision * interval '1 millisecond')
             THEN 1 ELSE api_rate_limits.hit_count + 1 END
         RETURNING hit_count, window_started_at`,
        [bucketKey, windowMs]
      );
      const hit = rows[0];
      requestsSinceCleanup += 1;
      if (requestsSinceCleanup >= 1000) {
        requestsSinceCleanup = 0;
        await database.query("DELETE FROM api_rate_limits WHERE window_started_at < now() - interval '1 day'");
      }
      if (hit.hit_count > max) {
        const resetAt = new Date(hit.window_started_at).getTime() + windowMs;
        res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
        return res.status(429).json({ error: message });
      }

      next();
    } catch (err) {
      logger.error('rate_limit_storage_failed', {
        requestId: req.requestId,
        errorName: err.name,
        errorCode: err.code,
      });
      next(err);
    }
  };
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  logger.error('request_failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    errorName: err.name,
    errorCode: err.code,
    status: err.status || 500,
  });
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Something went wrong on our side. Please try again.' });
}

module.exports = { headers, rateLimit, errorHandler, CONTENT_SECURITY_POLICY };
