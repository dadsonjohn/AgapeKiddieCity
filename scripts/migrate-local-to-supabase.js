/**
 * Copies the old local erp.db (SQLite) into Supabase.
 *
 * Usage:
 *   npm run migrate
 *   npm run migrate -- --force   # wipe existing Supabase rows first
 *
 * The local erp.db file is never modified, so you keep it as a backup.
 */

const fs = require('fs');
const path = require('path');
const { supabase, checkConnection } = require('../supabase');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  console.error('This script needs Node.js 22 or newer (node:sqlite is unavailable).');
  process.exit(1);
}

const dbPath = path.join(__dirname, '..', 'erp.db');
const force = process.argv.includes('--force');

function defaultClassLevel(section) {
  if (section === 'Crèche') return 'Crèche';
  if (section === 'Kindergarten') return 'Kindergarten 1';
  return 'Primary 1';
}

function withCreatedAt(payload, value) {
  if (value) payload.created_at = value;
  return payload;
}

async function countRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

async function wipeExistingData() {
  console.log('Wiping existing Supabase rows (--force)...');
  const deletions = [
    ['attendance', 'id'],
    ['payments', 'id'],
    ['fee_invoices', 'id'],
    ['pupils', 'id']
  ];
  for (const [table, column] of deletions) {
    const { error } = await supabase.from(table).delete().gt(column, 0);
    if (error) throw error;
    console.log(`  cleared ${table}`);
  }
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`Local database not found: ${dbPath}`);
    console.error('Nothing to migrate. The app will use the empty Supabase database.');
    process.exit(1);
  }

  await checkConnection();

  const local = new DatabaseSync(dbPath, { readOnly: true });

  const tableExists = name => !!local
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);

  const readAll = table => local.prepare(`SELECT * FROM ${table}`).all();
  const columnsOf = table => local.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

  const counts = {};
  for (const table of ['pupils', 'fee_invoices', 'payments', 'attendance']) {
    counts[table] = await countRows(table);
  }
  const totalExisting = Object.values(counts).reduce((sum, value) => sum + value, 0);

  if (totalExisting > 0) {
    if (!force) {
      console.error('Supabase already contains data:');
      Object.entries(counts).forEach(([table, count]) => console.error(`  ${table}: ${count}`));
      console.error('\nRun "npm run migrate -- --force" to wipe it and migrate the local database.');
      process.exit(1);
    }
    await wipeExistingData();
  }

  // --- Sections ---
  const sectionNames = new Set(['Crèche', 'Kindergarten', 'Primary']);
  if (tableExists('sections')) {
    readAll('sections').forEach(row => {
      if (row.name) sectionNames.add(row.name);
    });
  }
  for (const name of sectionNames) {
    const { error } = await supabase
      .from('sections')
      .upsert({ name }, { onConflict: 'name', ignoreDuplicates: true });
    if (error) throw error;
  }
  console.log(`Sections: ${sectionNames.size}`);

  // --- Pupils ---
  const pupilIdMap = new Map();
  const localPupils = tableExists('pupils') ? readAll('pupils') : [];
  const pupilHasClassLevel = tableExists('pupils') && columnsOf('pupils').includes('class_level');

  for (const pupil of localPupils) {
    const payload = withCreatedAt({
      full_name: pupil.full_name,
      section: pupil.section,
      class_level: (pupilHasClassLevel && pupil.class_level) || defaultClassLevel(pupil.section),
      guardian_name: pupil.guardian_name,
      guardian_phone: pupil.guardian_phone,
      enrollment_status: pupil.enrollment_status || 'Active'
    }, pupil.created_at);

    const { data, error } = await supabase.from('pupils').insert(payload).select('id').single();
    if (error) throw new Error(`Pupil "${pupil.full_name}": ${error.message}`);
    pupilIdMap.set(pupil.id, data.id);
  }
  console.log(`Pupils: ${localPupils.length}`);

  // --- Fee invoices ---
  const invoiceIdMap = new Map();
  const localInvoices = tableExists('fee_invoices') ? readAll('fee_invoices') : [];
  const invoiceHasDescription = tableExists('fee_invoices') && columnsOf('fee_invoices').includes('description');

  for (const invoice of localInvoices) {
    const newPupilId = pupilIdMap.get(invoice.pupil_id);
    if (!newPupilId) {
      console.warn(`  skipping invoice ${invoice.id}: pupil ${invoice.pupil_id} was not migrated`);
      continue;
    }

    const payload = withCreatedAt({
      pupil_id: newPupilId,
      term: invoice.term,
      academic_year: invoice.academic_year,
      description: invoiceHasDescription ? (invoice.description || null) : null,
      amount_billed: Number(invoice.amount_billed || 0),
      amount_paid: Number(invoice.amount_paid || 0),
      status: invoice.status || 'Unpaid'
    }, invoice.created_at);

    const { data, error } = await supabase.from('fee_invoices').insert(payload).select('id').single();
    if (error) throw new Error(`Invoice ${invoice.id}: ${error.message}`);
    invoiceIdMap.set(invoice.id, data.id);
  }
  console.log(`Fee invoices: ${invoiceIdMap.size}`);

  // --- Payments ---
  const localPayments = tableExists('payments') ? readAll('payments') : [];
  let paymentsMigrated = 0;

  for (const payment of localPayments) {
    const newInvoiceId = invoiceIdMap.get(payment.invoice_id);
    if (!newInvoiceId) {
      console.warn(`  skipping payment ${payment.id}: invoice ${payment.invoice_id} was not migrated`);
      continue;
    }

    const payload = {
      invoice_id: newInvoiceId,
      amount_paid: Number(payment.amount_paid || 0),
      note: payment.note || null
    };
    if (payment.payment_date) payload.payment_date = payment.payment_date;

    const { error } = await supabase.from('payments').insert(payload);
    if (error) throw new Error(`Payment ${payment.id}: ${error.message}`);
    paymentsMigrated += 1;
  }
  console.log(`Payments: ${paymentsMigrated}`);

  // --- Attendance ---
  const localAttendance = tableExists('attendance') ? readAll('attendance') : [];
  let attendanceMigrated = 0;

  for (const record of localAttendance) {
    const newPupilId = pupilIdMap.get(record.pupil_id);
    if (!newPupilId) {
      console.warn(`  skipping attendance ${record.id}: pupil ${record.pupil_id} was not migrated`);
      continue;
    }

    const payload = {
      pupil_id: newPupilId,
      attendance_date: String(record.attendance_date).slice(0, 10),
      status: record.status || 'Present'
    };
    if (record.created_at) payload.created_at = record.created_at;

    const { error } = await supabase
      .from('attendance')
      .upsert(payload, { onConflict: 'pupil_id,attendance_date' });
    if (error) throw new Error(`Attendance ${record.id}: ${error.message}`);
    attendanceMigrated += 1;
  }
  console.log(`Attendance records: ${attendanceMigrated}`);

  local.close();

  console.log('\nMigration complete. Your local erp.db was left untouched as a backup.');
}

main().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
