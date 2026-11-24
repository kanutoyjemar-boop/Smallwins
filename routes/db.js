const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set. Add a PostgreSQL connection string to .env (see .env.example).');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-this-to-something-long-and-random') {
  console.warn('JWT_SECRET is missing or still using the default placeholder. Set a real secret in your environment before deploying.');
}

const pool = new Pool({
  connectionString,
  // Railway's managed Postgres needs SSL, local dev usually doesn't.
  ssl: connectionString && connectionString.includes('railway') ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function migrate() {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured. Copy .env.example to .env and set a PostgreSQL connection string before starting the app.');
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Database schema is up to date.');
}

module.exports = { pool, migrate };
