require('dotenv').config({ quiet: true });

const { createClient } = require('@supabase/supabase-js');

// Accept the older service-role variable names as a convenience.
const secretKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_KEY;

let supabase;
try {
  if (!process.env.SUPABASE_URL || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in the environment.');
  }

  // The secret key gives the server full access and bypasses RLS. It is never
  // exposed to the browser; all database calls go through the Express server.
  supabase = createClient(process.env.SUPABASE_URL, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
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
