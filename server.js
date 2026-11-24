const app = require('./app');
const { checkConnection } = require('./supabase');

const PORT = process.env.PORT || 3000;

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
