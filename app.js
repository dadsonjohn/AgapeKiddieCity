const express = require('express');
const path = require('path');
const { supabase, checkConnection } = require('./supabase');
const { attachUser, requireAuth, requireAdmin } = require('./auth');
const authRoutes = require('./routes/auth');
const pupilRoutes = require('./routes/pupils');
const feeRoutes = require('./routes/fees');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');
const messageRoutes = require('./routes/messages');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Attach the signed-in user (if any) to every API request.
app.use('/api', attachUser);

// Health check (also useful for verifying the Supabase schema)
app.get('/api/health', async (req, res) => {
  try {
    await checkConnection();
    res.json({ ok: true, database: 'supabase' });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'supabase', error: err.message });
  }
});

// Authentication routes (login, signup, logout, account management)
app.use('/api/auth', authRoutes({ supabase }));

// API routes. Teachers can read pupils and manage attendance; everything
// financial and every pupil mutation is admin-only.
app.use('/api/pupils', requireAuth, pupilRoutes({ supabase, requireAdmin }));
app.use('/api/fees', requireAdmin, feeRoutes({ supabase }));
app.use('/api/attendance', requireAuth, attendanceRoutes({ supabase }));
app.use('/api/dashboard', requireAuth, dashboardRoutes({ supabase }));
app.use('/api/messages', requireAdmin, messageRoutes({ supabase }));

// Fallback: serve index.html for any non-API route (SPA-style)
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

module.exports = app;
