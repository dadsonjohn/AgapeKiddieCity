/**
 * Applies supabase/schema.sql using a direct Postgres connection.
 *
 * Add your database connection string to .env first:
 *   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
 *
 * Find it in Supabase Dashboard → Project Settings → Database → Connection string → URI.
 * Then run: npm run setup
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('SUPABASE_DB_URL is missing from .env.\n');
  console.error('Get it from Supabase Dashboard → Project Settings → Database → Connection string → URI,');
  console.error('then add this line to .env (keep the password):');
  console.error('  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres\n');
  console.error('Alternatively, paste supabase/schema.sql into the Supabase SQL Editor and run it.');
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'supabase', 'schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');

(async () => {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log('Supabase schema applied successfully.');
  } catch (err) {
    console.error('Failed to apply schema:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
})();
