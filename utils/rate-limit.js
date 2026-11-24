// Tiny in-memory fixed-window rate limiter (no dependency). Good enough for a
// single-instance deploy; put a shared store behind it if you ever scale out.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message = 'Too many attempts. Please wait a few minutes and try again.' } = {}) {
  const hits = new Map(); // key -> { count, resetAt }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
