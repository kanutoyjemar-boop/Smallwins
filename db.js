const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { databaseSslConfig } = require('./utils/database-ssl');

const connectionString = process.env.DATABASE_URL;
const migrationsDir = path.join(__dirname, 'migrations');

if (!connectionString) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL connection string to .env (see .env.example).');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-to-something-long-and-random') {
  console.warn('JWT_SECRET is missing or still using the default placeholder. Set a real secret in your environment before deploying.');
}

const pool = new Pool({
  connectionString,
  ssl: databaseSslConfig(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

function migrationList() {
  const baseline = { version: '001_initial', file: path.join(__dirname, 'schema.sql') };
  const names = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir) : [];
  const sqlFiles = names.filter((name) => name.endsWith('.sql'));
  const invalid = sqlFiles.filter((name) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name));
  if (invalid.length) throw new Error(`Invalid migration filename(s): ${invalid.join(', ')}`);
  const later = sqlFiles.sort().map((name) => ({
    version: name.slice(0, -4),
    file: path.join(migrationsDir, name),
  }));
  return [baseline, ...later];
}

function migrationVersions() {
  return migrationList().map((migration) => migration.version);
}

async function migrate() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured. Copy .env.example to .env and set a PostgreSQL connection string before starting the app.');
  }

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [741205]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const migration of migrationList()) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [migration.version]);
      if (applied.rowCount) continue;

      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(migration.file, 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
        await client.query('COMMIT');
        console.log(`Applied database migration ${migration.version}.`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('Database migrations are up to date.');
  } finally {
    try {
      if (lockAcquired) await client.query('SELECT pg_advisory_unlock($1)', [741205]);
    } finally {
      client.release();
    }
  }
}

module.exports = { pool, migrate, migrationVersions };
