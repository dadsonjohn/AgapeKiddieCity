const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'erp.db');

let db = null;

async function init() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  // Load existing database file if present, otherwise start fresh
  let existingBuffer = null;
  if (fs.existsSync(dbPath)) {
    existingBuffer = fs.readFileSync(dbPath);
  }

  db = new SQL.Database(existingBuffer);

  // Enable foreign keys
  db.run('PRAGMA foreign_keys = ON');

  // Create tables if not exist
  db.run(`
    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pupils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      section TEXT NOT NULL,
      class_level TEXT,
      guardian_name TEXT NOT NULL,
      guardian_phone TEXT NOT NULL,
      enrollment_status TEXT DEFAULT 'Active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fee_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pupil_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      description TEXT,
      amount_billed REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'Unpaid',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pupil_id) REFERENCES pupils(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT,
      FOREIGN KEY (invoice_id) REFERENCES fee_invoices(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pupil_id INTEGER NOT NULL,
      attendance_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Present',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pupil_id) REFERENCES pupils(id) ON DELETE CASCADE,
      UNIQUE(pupil_id, attendance_date)
    );
  `);

  // Upgrade older databases in place (adds new columns without losing data)
  migrateSchema();

  // Insert sections if not exists
  ['Crèche', 'Kindergarten', 'Primary'].forEach(name => run('INSERT OR IGNORE INTO sections (name) VALUES (?)', [name]));

  // Seed sample data if tables are empty
  const pupilCount = get('SELECT COUNT(*) as count FROM pupils');
  if (pupilCount.count === 0) {
    seedData();
  }

  // Persist to disk
  save();

  console.log('Database initialized at', dbPath);
}

function save() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

// Adds columns introduced in newer versions to an existing database file.
function migrateSchema() {
  const addColumnIfMissing = (table, column, definition) => {
    const columns = all(`PRAGMA table_info(${table})`);
    if (!columns.some(c => c.name === column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  addColumnIfMissing('pupils', 'class_level', 'TEXT');
  addColumnIfMissing('fee_invoices', 'description', 'TEXT');

  // Give existing pupils a sensible class so they can be filtered/invoiced by class.
  db.run(`
    UPDATE pupils
    SET class_level = CASE
      WHEN section = 'Crèche' THEN 'Crèche'
      WHEN section = 'Kindergarten' THEN 'Kindergarten 1'
      ELSE 'Primary 1'
    END
    WHERE class_level IS NULL OR TRIM(class_level) = ''
  `);
}

function run(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  stmt.run();
  stmt.free();
  save();
  const lastInsertRowid = get('SELECT last_insert_rowid() AS id').id;
  const changes = get('SELECT changes() AS c').c;
  return { lastInsertRowid, changes };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result = [];
  while (stmt.step()) {
    result.push(stmt.getAsObject());
  }
  stmt.free();
  return result;
}

function seedData() {
  const samplePupils = [
    ['Ama Mensah', 'Crèche', 'Crèche', 'Kwame Mensah', '0244123456', 'Active'],
    ['Kofi Asare', 'Crèche', 'Crèche', 'Akosua Asare', '0244234567', 'Active'],
    ['Esi Amoah', 'Crèche', 'Crèche', 'Yaw Amoah', '0244345678', 'Active'],
    ['Ama Osei', 'Kindergarten', 'Kindergarten 1', 'Kwasi Osei', '0244456789', 'Active'],
    ['Kwame Darko', 'Kindergarten', 'Kindergarten 1', 'Efua Darko', '0244567890', 'Active'],
    ['Adjoa Boateng', 'Kindergarten', 'Kindergarten 2', 'Kofi Boateng', '0244678901', 'Active'],
    ['Kwaku Nti', 'Primary', 'Primary 3', 'Akua Nti', '0244789012', 'Active'],
    ['Akosua Frimpong', 'Primary', 'Primary 4', 'Kofi Frimpong', '0244890123', 'Active'],
    ['Yaw Agyei', 'Primary', 'Primary 5', 'Ama Agyei', '0244901234', 'Active'],
    ['Nana Yeboah', 'Primary', 'Primary 6', 'Kwame Yeboah', '0245012345', 'Active']
  ];

  const pupilIds = [];
  samplePupils.forEach(p => {
    const info = run(
      `INSERT INTO pupils (full_name, section, class_level, guardian_name, guardian_phone, enrollment_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      p
    );
    pupilIds.push({ id: info.lastInsertRowid, section: p[1], name: p[0] });
  });

  const feeData = [
    ['Ama Mensah', 'Term 1', '2024-2025', 1200, 1200],   // Paid
    ['Kofi Asare', 'Term 1', '2024-2025', 1200, 600],    // Partial
    ['Esi Amoah', 'Term 1', '2024-2025', 1200, 0],       // Unpaid
    ['Ama Osei', 'Term 1', '2024-2025', 1500, 1500],     // Paid
    ['Kwame Darko', 'Term 1', '2024-2025', 1500, 500],   // Partial
    ['Adjoa Boateng', 'Term 1', '2024-2025', 1500, 0],   // Unpaid
    ['Kwaku Nti', 'Term 1', '2024-2025', 2000, 2000],    // Paid
    ['Akosua Frimpong', 'Term 1', '2024-2025', 2000, 800], // Partial
    ['Yaw Agyei', 'Term 1', '2024-2025', 2000, 0],       // Unpaid
    ['Nana Yeboah', 'Term 1', '2024-2025', 2000, 2000]   // Paid
  ];

  feeData.forEach(([name, term, year, billed, paid]) => {
    const pupil = pupilIds.find(p => p.name === name);
    if (!pupil) return;

    const status = paid >= billed ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';
    const info = run(
      `INSERT INTO fee_invoices (pupil_id, term, academic_year, amount_billed, amount_paid, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [pupil.id, term, year, billed, paid, status]
    );

    if (paid > 0) {
      run(
        `INSERT INTO payments (invoice_id, amount_paid, note) VALUES (?, ?, ?)`,
        [info.lastInsertRowid, paid, 'Initial fee payment']
      );
    }
  });
}

module.exports = { init, run, get, all };
