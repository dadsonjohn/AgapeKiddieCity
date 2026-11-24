const express = require('express');
const path = require('path');
const { supabase, checkConnection } = require('./supabase');
const pupilRoutes = require('./routes/pupils');
const feeRoutes = require('./routes/fees');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Health check (also useful for verifying the Supabase schema)
app.get('/api/health', async (req, res) => {
  try {
    await checkConnection();
    res.json({ ok: true, database: 'supabase' });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'supabase', error: err.message });
  }
});

// API routes
app.use('/api/pupils', pupilRoutes({ supabase }));
app.use('/api/fees', feeRoutes({ supabase }));
app.use('/api/attendance', attendanceRoutes({ supabase }));
app.use('/api/dashboard', dashboardRoutes({ supabase }));

// Fallback: serve index.html for any non-API route (SPA-style)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

module.exports = app;
