require('dotenv').config();
const { Pool } = require('pg');
const { migrationVersions } = require('../db');

const REQUIRED_TABLES = [
  'users',
  'tasks',
  'workouts',
  'diet_entries',
  'expenses',
  'notification_settings',
  'notification_deliveries',
  'api_rate_limits',
  'schema_migrations',
];

function databaseIdentity(connectionString) {
  const url = new URL(connectionString);
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
}

function connectionPool(connectionString) {
  return new Pool({
    connectionString,
    ssl: connectionString.includes('railway') ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });
}

async function verifyRestore() {
  if (!process.env.DATABASE_URL || !process.env.RESTORE_DATABASE_URL) {
    throw new Error('Set DATABASE_URL and RESTORE_DATABASE_URL before verifying a restore.');
  }
  if (databaseIdentity(process.env.DATABASE_URL) === databaseIdentity(process.env.RESTORE_DATABASE_URL)) {
    throw new Error('RESTORE_DATABASE_URL must point to a database separate from DATABASE_URL.');
  }

  const livePool = connectionPool(process.env.DATABASE_URL);
  const restorePool = connectionPool(process.env.RESTORE_DATABASE_URL);
  try {
    const liveIdentity = await livePool.query(
      'SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port'
    );
    const client = await restorePool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const restoredIdentity = await client.query(
        'SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port'
      );
      if (JSON.stringify(liveIdentity.rows[0]) === JSON.stringify(restoredIdentity.rows[0])) {
        throw new Error('RESTORE_DATABASE_URL resolves to the same PostgreSQL database as DATABASE_URL.');
      }
      const { rows } = await client.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [REQUIRED_TABLES]
      );
      const found = new Set(rows.map((row) => row.table_name));
      const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
      if (missing.length) {
        throw new Error(`Restored database is missing required tables: ${missing.join(', ')}.`);
      }

      const migrations = await client.query('SELECT version FROM schema_migrations');
      const appliedMigrations = new Set(migrations.rows.map((row) => row.version));
      const missingMigrations = migrationVersions().filter((version) => !appliedMigrations.has(version));
      if (missingMigrations.length) {
        throw new Error(`Restored database is missing migrations: ${missingMigrations.join(', ')}.`);
      }
      await client.query('ROLLBACK');
      console.log(JSON.stringify({
        ok: true,
        event: 'restore_verification_passed',
        tableCount: found.size,
        migrationCount: migrations.rows.length,
      }));
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await Promise.all([livePool.end(), restorePool.end()]);
  }
}

if (require.main === module) {
  verifyRestore().catch((err) => {
    console.error(`Restore verification failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { databaseIdentity, verifyRestore };
