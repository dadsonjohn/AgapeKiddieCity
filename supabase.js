require('dotenv').config({ quiet: true });

// @supabase/server uses SUPABASE_SECRET_KEY (or SUPABASE_SECRET_KEYS).
// Accept the older service-role variable names as a convenience.
if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SECRET_KEYS) {
  const legacyKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (legacyKey) process.env.SUPABASE_SECRET_KEY = legacyKey;
}

const { createAdminClient } = require('@supabase/server/core');

let supabase;
try {
  supabase = createAdminClient();
} catch (err) {
  console.error('\n[Supabase] Could not create the database client.');
  console.error('[Supabase] ' + err.message);
  console.error('\nAdd these to your .env file (see .env.example):');
  console.error('  SUPABASE_URL=https://your-project-ref.supabase.co');
  console.error('  SUPABASE_SECRET_KEY=your-secret-key\n');
  process.exit(1);
}

// Fails fast with a useful message if the schema has not been applied yet.
async function checkConnection() {
  const { error } = await supabase.from('sections').select('id').limit(1);
  if (error) {
    const hint = error.code === 'PGRST205' || /does not exist/i.test(error.message || '')
      ? 'Run the SQL in supabase/schema.sql inside your Supabase project first.'
      : 'Check SUPABASE_URL and SUPABASE_SECRET_KEY in .env.';
    throw new Error(`${error.message}. ${hint}`);
  }
}

module.exports = { supabase, checkConnection };
