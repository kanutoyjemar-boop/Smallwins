require('dotenv').config();
require('./utils/async-errors');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool, migrationVersions } = require('./db');
const { headers, rateLimit, errorHandler } = require('./middleware/security');
const { requestLogging } = require('./middleware/request-logging');
const logger = require('./utils/logger');

// Behind Railway's proxy the real client IP is in X-Forwarded-For, so rate limits
// only work per-user when exactly one hop is trusted. Explicit TRUST_PROXY always wins.
function resolveTrustProxy(env = process.env) {
  const configured = env.TRUST_PROXY;
  if (configured === undefined || configured === '') {
    return env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID ? 1 : false;
  }
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  if (/^\d+$/.test(configured)) return Number(configured);
  return configured;
}

// The UI is served by this same server, so cross-origin access is not needed.
// CORS_ORIGIN opens it to specific sites; in production with no setting, it stays closed.
function resolveCorsOptions(env = process.env) {
  const origins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : [];
  if (origins.length) return { origin: origins };
  return env.NODE_ENV === 'production' ? { origin: false } : undefined;
}

function createApp({ database = require('./db').pool } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', resolveTrustProxy());
  app.use(requestLogging);
  app.use(headers);
  // Set CORS_ORIGIN (e.g. https://yourapp.up.railway.app) to lock the API to your site.
  app.use(cors(resolveCorsOptions()));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/auth/login', rateLimit({ max: 10, database }));
  app.use('/api/auth/signup', rateLimit({ max: 8, windowMs: 60 * 60 * 1000, database }));
  app.use('/api/auth/password/forgot', rateLimit({ max: 4, windowMs: 60 * 60 * 1000, database }));
  app.use('/api/auth/password/reset', rateLimit({ max: 8, windowMs: 60 * 60 * 1000, database }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/tasks', require('./routes/tasks'));
  app.use('/api/recurring', require('./routes/recurring'));
  app.use('/api/money', require('./routes/money'));
  app.use('/api/savings', require('./routes/savings'));
  app.use('/api/workouts', require('./routes/workouts'));
  app.use('/api/diet', require('./routes/diet'));
  app.use('/api/schedule', require('./routes/schedule'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/preferences', require('./routes/preferences'));
  app.use('/api/goals', require('./routes/goals'));
  app.use('/api/recovery', require('./routes/recovery'));
  app.use('/api/templates', require('./routes/templates'));
  app.use('/api/reflections', require('./routes/reflections'));
  app.use('/api/notifications', require('./routes/notifications'));
  app.use('/api/export', require('./routes/export'));
  app.use('/api/sample-data', require('./routes/sample-data'));

  app.get('/api/health/live', (req, res) => res.json({ ok: true }));
  const readiness = async (req, res) => {
    try {
      const result = await database.query('SELECT version FROM schema_migrations');
      const applied = new Set(result.rows.map((row) => row.version));
      const pending = migrationVersions().filter((version) => !applied.has(version));
      if (pending.length) return res.status(503).json({ ok: false, error: 'Database migrations are pending.' });
      res.json({ ok: true, database: 'ready' });
    } catch (err) {
      logger.error('readiness_check_failed', {
        requestId: req.requestId,
        errorName: err.name,
        errorCode: err.code,
      });
      res.status(503).json({ ok: false, error: 'Database is unavailable or migrations are pending.' });
    }
  };
  app.get('/api/health/ready', readiness);
  app.get('/api/health', readiness);

  app.get('/vendor/chart.umd.js', (req, res, next) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), (err) => {
      if (err) next(err);
    });
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.use(errorHandler);
  return app;
}

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32
    || process.env.JWT_SECRET === 'change-this-to-something-long-and-random') {
    throw new Error('JWT_SECRET must be set to a random value at least 32 characters long.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');

  require('./utils/mailer').validateConfig();
  const app = createApp();
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => logger.info('server_started', { port }));
  const scheduler = require('./utils/scheduler');
  scheduler.start();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_started', { signal });
    const timeout = setTimeout(() => {
      logger.error('shutdown_timeout', { signal, timeoutMs: 15000 });
      server.closeAllConnections();
      process.exit(1);
    }, 15000);
    try {
      await closeResources(server, () => scheduler.stop(), pool);
      clearTimeout(timeout);
      logger.info('shutdown_completed', { signal });
      process.exit(0);
    } catch (err) {
      clearTimeout(timeout);
      logger.error('shutdown_failed', { signal, errorName: err.name, errorCode: err.code });
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

async function closeResources(server, stopScheduler, databasePool) {
  const serverClosed = new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
  try {
    await Promise.all([serverClosed, stopScheduler()]);
  } finally {
    await databasePool.end();
  }
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start SelfUp:', err.message);
    process.exit(1);
  });
}

module.exports = { createApp, closeResources, resolveTrustProxy, resolveCorsOptions };
