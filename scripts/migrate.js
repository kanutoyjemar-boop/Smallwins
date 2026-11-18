// Apply any pending versioned database migrations and exit.
require('dotenv').config();
const { pool, migrate } = require('../db');

migrate()
  .then(() => pool.end())
  .then(() => { process.exitCode = 0; })
  .catch(async (err) => {
    console.error('Migration failed:', err.message);
    try {
      await pool.end();
    } catch (closeError) {
      console.error('Failed to close the database pool:', closeError.message);
    }
    process.exitCode = 1;
  });
