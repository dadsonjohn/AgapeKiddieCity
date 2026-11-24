const express = require('express');
const path = require('path');
const { supabase, checkConnection } = require('./supabase');
const pupilRoutes = require('./routes/pupils');
const feeRoutes = require('./routes/fees');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

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

(async () => {
  try {
    await checkConnection();
    console.log('Connected to Supabase at', process.env.SUPABASE_URL);
  } catch (err) {
    console.error('\n[Supabase] Connection check failed:', err.message);
    console.error('[Supabase] The server will start, but database calls will fail until this is fixed.\n');
  }

  app.listen(PORT, () => {
    console.log(`Agape Kiddie City Academy ERP running at http://localhost:${PORT}`);
  });
})();
