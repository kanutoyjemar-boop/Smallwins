// Runs schema.sql against DATABASE_URL and exits. Same migration the server
// runs on boot, available as `npm run migrate` for CI / one-off deploy steps.
require('dotenv').config();
const { pool, migrate } = require('../db');

migrate()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
