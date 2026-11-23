const express = require('express');
const path = require('path');
const { init, run, get, all } = require('./db');
const pupilRoutes = require('./routes/pupils');
const feeRoutes = require('./routes/fees');
const attendanceRoutes = require('./routes/attendance');
const dashboardRoutes = require('./routes/dashboard');

// Initialize database (creates tables and seed data on first run)
init().then(() => {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, 'public')));

  // API routes (pass db helpers to routes)
  app.use('/api/pupils', pupilRoutes({ run, get, all }));
  app.use('/api/fees', feeRoutes({ run, get, all }));
  app.use('/api/attendance', attendanceRoutes({ run, get, all }));
  app.use('/api/dashboard', dashboardRoutes({ run, get, all }));

  // Fallback: serve index.html for any non-API route (SPA-style)
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
  });

  app.listen(PORT, () => {
    console.log(`Agape Kiddie City Academy ERP running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
