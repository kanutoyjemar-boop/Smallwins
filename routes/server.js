require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
require('./utils/async-errors'); // must load before any route file
const { migrate } = require('./db');

const app = express();
app.use(cors());
// Backups can be a few MB once a year of daily logs is in there.
app.use(express.json({ limit: '10mb' }));

if (!process.env.JWT_SECRET) {
  console.warn('Missing JWT_SECRET; auth requests will fail until it is configured in .env.');
}

app.use('/api/auth', require('./routes/auth'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/money', require('./routes/money'));
app.use('/api/workouts', require('./routes/workouts'));
app.use('/api/diet', require('./routes/diet'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/reflections', require('./routes/reflections'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/export', require('./routes/export'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the frontend (single-page app, no build step needed).
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Last-resort error handler: log it, answer with JSON instead of hanging.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large to import.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;

migrate()
  .then(() => {
    app.listen(PORT, () => console.log(`SelfUp running on port ${PORT}`));
    require('./utils/scheduler').start();
  })
  .catch((err) => {
    console.error('Failed to run database migration:', err);
    process.exit(1);
  });
