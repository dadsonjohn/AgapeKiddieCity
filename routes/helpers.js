const { sectionRank, classRank } = require('../constants');

function fail(res, err, message) {
  console.error(err);
  return res.status(500).json({ error: message });
}

// PostgREST reports a missing table as PGRST205 (its schema cache), while a
// direct Postgres connection reports 42P01. Accept both.
function isMissingTable(error) {
  return Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205');
}

function isMissingColumn(error, column) {
  if (!error) return false;
  const missing = error.code === '42703' || error.code === 'PGRST204';
  if (!missing) return false;
  if (!column) return true;
  return String(error.message || '').toLowerCase().includes(String(column).toLowerCase());
}

function parseId(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? Number(text) : null;
}

function comparePupils(a, b) {
  return sectionRank(a.section) - sectionRank(b.section)
    || classRank(a.class_level) - classRank(b.class_level)
    || String(a.full_name || '').localeCompare(String(b.full_name || ''));
}

function mapInvoice(row) {
  const pupil = row.pupil || {};
  const { pupil: _pupil, ...invoice } = row;
  const billed = Number(invoice.amount_billed || 0);
  const paid = Number(invoice.amount_paid || 0);

  return {
    ...invoice,
    amount_billed: billed,
    amount_paid: paid,
    pupil_name: pupil.full_name || 'Unknown pupil',
    pupil_section: pupil.section || '',
    pupil_class: pupil.class_level || pupil.section || '',
    balance_due: billed - paid
  };
}

function compareInvoices(a, b) {
  return sectionRank(a.pupil_section) - sectionRank(b.pupil_section)
    || classRank(a.pupil_class) - classRank(b.pupil_class)
    || String(a.pupil_name || '').localeCompare(String(b.pupil_name || ''));
}

module.exports = {
  fail,
  parseId,
  comparePupils,
  mapInvoice,
  compareInvoices,
  isMissingTable,
  isMissingColumn
};
