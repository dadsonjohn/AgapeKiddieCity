const API = '/api';

// --- Class definitions ---
const CLASS_LEVELS = {
  'Crèche': ['Crèche'],
  'Kindergarten': ['Kindergarten 1', 'Kindergarten 2'],
  'Primary': ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']
};
const SECTION_ORDER = ['Crèche', 'Kindergarten', 'Primary'];
const CLASS_ORDER = ['Crèche', 'Kindergarten 1', 'Kindergarten 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'];

// --- Money visibility (eye toggle) ---
const amountVisibility = { dashboard: false, fees: false };
const EYE_OPEN = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function formatMoney(value) {
  return 'GHS ' + Number(value || 0).toFixed(2);
}

function setEyeButton(scope) {
  const btn = document.getElementById(`${scope}-eye`);
  if (!btn) return;
  const visible = amountVisibility[scope];
  btn.innerHTML = visible ? EYE_OPEN : EYE_CLOSED;
  btn.title = visible ? 'Hide amounts' : 'Show amounts';
  btn.setAttribute('aria-label', btn.title);
  btn.classList.toggle('is-visible', visible);
}

function setMoneyElement(el, value) {
  if (!el) return;
  el.dataset.value = value;
  el.textContent = amountVisibility[el.dataset.moneyScope] ? formatMoney(value) : 'GHS ••••';
}

function refreshAmounts(scope) {
  document.querySelectorAll(`[data-money-scope="${scope}"]`).forEach(el => {
    el.textContent = amountVisibility[scope] ? formatMoney(el.dataset.value) : 'GHS ••••';
  });
  setEyeButton(scope);
}

function toggleAmounts(scope) {
  amountVisibility[scope] = !amountVisibility[scope];
  refreshAmounts(scope);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

// --- Class select helpers ---
function classOptionsFor(section) {
  if (!section) return Object.values(CLASS_LEVELS).flat();
  return CLASS_LEVELS[section] || [];
}

function fillClassSelect(select, section, selected, allLabel) {
  if (!select) return;
  select.innerHTML = '';
  if (allLabel !== undefined) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = allLabel;
    select.appendChild(opt);
  }
  classOptionsFor(section).forEach(level => {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = level;
    select.appendChild(opt);
  });
  if (selected) select.value = selected;
}

// --- Navigation ---
const navLinks = document.querySelectorAll('.nav-link');
const pages = document.querySelectorAll('.page');

navLinks.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const section = link.dataset.section;

    navLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    pages.forEach(p => p.classList.remove('active'));
    document.getElementById(section).classList.add('active');

    loadPageData(section);
  });
});

function loadPageData(section) {
  if (section === 'dashboard') loadDashboard();
  if (section === 'pupils') loadPupils();
  if (section === 'fees') loadFees();
  if (section === 'attendance') {
    ensureAttendanceDate();
    loadAttendance();
  }
}

// --- Dashboard ---
async function loadDashboard() {
  try {
    const res = await fetch(`${API}/dashboard/summary`);
    const data = await res.json();

    document.getElementById('stat-total-pupils').textContent = data.totalPupils;
    setMoneyElement(document.getElementById('stat-total-billed'), data.totalBilled);
    setMoneyElement(document.getElementById('stat-total-collected'), data.totalCollected);
    setMoneyElement(document.getElementById('stat-outstanding'), data.outstandingBalance);

    const tbody = document.getElementById('section-table-body');
    tbody.innerHTML = '';
    data.pupilsPerSection.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.section}</td><td>${s.count}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    alert('Failed to load dashboard');
  }
}

// --- Pupils ---
function onPupilSectionFilterChange() {
  const section = document.getElementById('filter-section').value;
  fillClassSelect(document.getElementById('filter-class'), section, '', 'All Classes');
  loadPupils();
}

async function loadPupils() {
  try {
    const section = document.getElementById('filter-section').value;
    const classLevel = document.getElementById('filter-class').value;
    const search = document.getElementById('filter-search').value;
    let url = `${API}/pupils?`;
    if (section) url += `section=${encodeURIComponent(section)}&`;
    if (classLevel) url += `class_level=${encodeURIComponent(classLevel)}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;

    const res = await fetch(url);
    const pupils = await res.json();

    const tbody = document.getElementById('pupils-table-body');
    tbody.innerHTML = '';
    pupils.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.full_name)}</td>
        <td>${escapeHtml(p.class_level || p.section)}</td>
        <td>${escapeHtml(p.guardian_name)}</td>
        <td>${escapeHtml(p.guardian_phone)}</td>
        <td><span class="status-badge status-${p.enrollment_status}">${p.enrollment_status}</span></td>
        <td class="row-actions">
          <button class="btn btn-sm btn-primary" onclick="editPupil(${p.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deletePupil(${p.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (pupils.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No pupils found.</td></tr>';
    }
  } catch (err) {
    console.error(err);
    alert('Failed to load pupils');
  }
}

function onPupilFormSectionChange() {
  const section = document.getElementById('pupil-section').value;
  fillClassSelect(document.getElementById('pupil-class'), section);
}

function openPupilModal(pupil = null) {
  const modal = document.getElementById('pupil-modal');
  const title = document.getElementById('pupil-modal-title');
  const form = document.getElementById('pupil-form');

  form.reset();
  document.getElementById('pupil-id').value = '';

  if (pupil) {
    title.textContent = 'Edit Pupil';
    document.getElementById('pupil-id').value = pupil.id;
    document.getElementById('pupil-full-name').value = pupil.full_name;
    document.getElementById('pupil-section').value = pupil.section;
    fillClassSelect(document.getElementById('pupil-class'), pupil.section, pupil.class_level);
    document.getElementById('pupil-guardian-name').value = pupil.guardian_name;
    document.getElementById('pupil-guardian-phone').value = pupil.guardian_phone;
    document.getElementById('pupil-enrollment-status').value = pupil.enrollment_status;
  } else {
    title.textContent = 'Add Pupil';
    document.getElementById('pupil-section').value = 'Crèche';
    fillClassSelect(document.getElementById('pupil-class'), 'Crèche');
  }

  modal.style.display = 'flex';
}

function closePupilModal() {
  document.getElementById('pupil-modal').style.display = 'none';
}

async function editPupil(id) {
  try {
    const res = await fetch(`${API}/pupils/${id}`);
    const pupil = await res.json();
    openPupilModal(pupil);
  } catch (err) {
    alert('Failed to load pupil');
  }
}

async function deletePupil(id) {
  if (!confirm('Are you sure you want to delete this pupil?')) return;
  try {
    await fetch(`${API}/pupils/${id}`, { method: 'DELETE' });
    loadPupils();
    loadDashboard();
  } catch (err) {
    alert('Failed to delete pupil');
  }
}

document.getElementById('pupil-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('pupil-id').value;
  const pupilData = {
    full_name: document.getElementById('pupil-full-name').value,
    section: document.getElementById('pupil-section').value,
    class_level: document.getElementById('pupil-class').value,
    guardian_name: document.getElementById('pupil-guardian-name').value,
    guardian_phone: document.getElementById('pupil-guardian-phone').value,
    enrollment_status: document.getElementById('pupil-enrollment-status').value
  };

  try {
    const res = await fetch(id ? `${API}/pupils/${id}` : `${API}/pupils`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pupilData)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save pupil');
    }
    closePupilModal();
    loadPupils();
    loadDashboard();
  } catch (err) {
    alert(err.message || 'Failed to save pupil');
  }
});

// --- Fees ---
let feeInvoicesCache = [];

async function loadFees() {
  try {
    const res = await fetch(`${API}/fees`);
    const invoices = await res.json();
    feeInvoicesCache = invoices;

    // Populate pupil dropdown in the individual invoice modal
    const pupilRes = await fetch(`${API}/pupils`);
    const pupils = await pupilRes.json();
    const pupilSelect = document.getElementById('invoice-pupil');
    pupilSelect.innerHTML = '';
    pupils.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.full_name} (${p.class_level || p.section})`;
      pupilSelect.appendChild(opt);
    });

    // Summary totals
    const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.amount_billed || 0), 0);
    const totalCollected = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
    setMoneyElement(document.getElementById('fees-total-billed'), totalBilled);
    setMoneyElement(document.getElementById('fees-total-collected'), totalCollected);
    setMoneyElement(document.getElementById('fees-outstanding'), totalBilled - totalCollected);

    renderFeeGroups(invoices);
  } catch (err) {
    console.error(err);
    alert('Failed to load fees');
  }
}

function sectionForClass(className) {
  if (className.startsWith('Primary')) return 'Primary';
  if (className.startsWith('Kindergarten')) return 'Kindergarten';
  return 'Crèche';
}

function renderFeeGroups(invoices) {
  const container = document.getElementById('fees-groups');
  refreshAmounts('fees');

  if (!invoices.length) {
    container.innerHTML = '<div class="empty-state">No invoices yet. Create an individual invoice or a general invoice to get started.</div>';
    return;
  }

  const byClass = {};
  invoices.forEach(inv => {
    const className = inv.pupil_class || inv.pupil_section || 'Unassigned';
    (byClass[className] = byClass[className] || []).push(inv);
  });

  const sectionSlugs = { 'Crèche': 'creche', 'Kindergarten': 'kindergarten', 'Primary': 'primary' };
  let html = '';

  SECTION_ORDER.forEach(section => {
    const classes = Object.keys(byClass)
      .filter(cls => sectionForClass(cls) === section)
      .sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));

    if (!classes.length) return;

    const sectionInvoices = classes.flatMap(cls => byClass[cls]);
    const sectionBilled = sectionInvoices.reduce((s, inv) => s + Number(inv.amount_billed || 0), 0);
    const sectionCollected = sectionInvoices.reduce((s, inv) => s + Number(inv.amount_paid || 0), 0);

    html += `
      <section class="fee-section fee-section-${sectionSlugs[section]}">
        <div class="fee-section-header">
          <div class="fee-section-title">
            <h3>${section}</h3>
            <span class="badge">${sectionInvoices.length} invoice${sectionInvoices.length === 1 ? '' : 's'}</span>
          </div>
          <div class="fee-section-totals">
            <span>Billed <span class="money" data-money-scope="fees" data-value="${sectionBilled}"></span></span>
            <span>Collected <span class="money" data-money-scope="fees" data-value="${sectionCollected}"></span></span>
            <span>Outstanding <span class="money" data-money-scope="fees" data-value="${sectionBilled - sectionCollected}"></span></span>
          </div>
        </div>
    `;

    classes.forEach(className => {
      const list = byClass[className].slice().sort((a, b) => a.pupil_name.localeCompare(b.pupil_name));
      const classBilled = list.reduce((s, inv) => s + Number(inv.amount_billed || 0), 0);
      const classCollected = list.reduce((s, inv) => s + Number(inv.amount_paid || 0), 0);
      const pupilCount = new Set(list.map(inv => inv.pupil_id)).size;

      const rows = list.map(inv => `
        <tr>
          <td>${escapeHtml(inv.pupil_name)}</td>
          <td>${escapeHtml(inv.term)} / ${escapeHtml(inv.academic_year)}</td>
          <td>${inv.description ? escapeHtml(inv.description) : '<span class="muted">—</span>'}</td>
          <td><span class="money" data-money-scope="fees" data-value="${Number(inv.amount_billed || 0)}"></span></td>
          <td><span class="money" data-money-scope="fees" data-value="${Number(inv.amount_paid || 0)}"></span></td>
          <td><span class="money" data-money-scope="fees" data-value="${Number(inv.balance_due || 0)}"></span></td>
          <td><span class="status-badge status-${inv.status}">${inv.status}</span></td>
          <td class="row-actions">
            <button class="btn btn-sm btn-success" onclick="openPaymentModal(${inv.id})">Pay</button>
            <button class="btn btn-sm btn-danger" onclick="deleteInvoice(${inv.id})">Delete</button>
          </td>
        </tr>
      `).join('');

      html += `
        <div class="fee-group">
          <div class="fee-group-header">
            <div>
              <h4>${escapeHtml(className)}</h4>
              <span class="badge badge-light">${pupilCount} pupil${pupilCount === 1 ? '' : 's'}</span>
            </div>
            <div class="fee-group-totals">
              <span>Billed <span class="money" data-money-scope="fees" data-value="${classBilled}"></span></span>
              <span>Outstanding <span class="money" data-money-scope="fees" data-value="${classBilled - classCollected}"></span></span>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pupil</th>
                  <th>Term / Year</th>
                  <th>Description</th>
                  <th>Billed</th>
                  <th>Paid</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    });

    html += `</section>`;
  });

  container.innerHTML = html;
  refreshAmounts('fees');
}

function openInvoiceModal() {
  document.getElementById('invoice-modal').style.display = 'flex';
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').style.display = 'none';
}

document.getElementById('invoice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    pupil_id: document.getElementById('invoice-pupil').value,
    term: document.getElementById('invoice-term').value,
    academic_year: document.getElementById('invoice-academic-year').value,
    description: document.getElementById('invoice-description').value,
    amount_billed: document.getElementById('invoice-amount-billed').value
  };

  try {
    const res = await fetch(`${API}/fees`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create invoice');
    }
    closeInvoiceModal();
    e.target.reset();
    loadFees();
    loadDashboard();
  } catch (err) {
    alert(err.message || 'Failed to create invoice');
  }
});

function openBatchInvoiceModal() {
  document.getElementById('batch-invoice-modal').style.display = 'flex';
}

function closeBatchInvoiceModal() {
  document.getElementById('batch-invoice-modal').style.display = 'none';
}

document.getElementById('batch-invoice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    target: document.getElementById('batch-target').value,
    term: document.getElementById('batch-term').value,
    academic_year: document.getElementById('batch-academic-year').value,
    description: document.getElementById('batch-description').value,
    amount_billed: document.getElementById('batch-amount-billed').value
  };

  try {
    const res = await fetch(`${API}/fees/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to create general invoice');

    closeBatchInvoiceModal();
    e.target.reset();

    if (result.created === 0) {
      if (result.skipped > 0) {
        alert(`No new invoices created. ${result.skipped} pupil(s) already had an invoice for that term.`);
      } else {
        alert('No active pupils were found in that group.');
      }
    } else {
      const extra = result.skipped ? ` ${result.skipped} pupil(s) already had an invoice and were skipped.` : '';
      alert(`Created ${result.created} invoice(s) for ${formatMoney(result.total_billed)}.${extra}`);
    }

    loadFees();
    loadDashboard();
  } catch (err) {
    alert(err.message || 'Failed to create general invoice');
  }
});

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  try {
    await fetch(`${API}/fees/${id}`, { method: 'DELETE' });
    loadFees();
    loadDashboard();
  } catch (err) {
    alert('Failed to delete invoice');
  }
}

// --- Payments ---
function openPaymentModal(invoiceId) {
  const inv = feeInvoicesCache.find(i => i.id === invoiceId);
  const label = inv
    ? `${inv.pupil_name} — ${inv.pupil_class || inv.pupil_section} · ${inv.term} ${inv.academic_year}`
    : '';
  document.getElementById('payment-invoice-label').textContent = label;
  document.getElementById('payment-invoice-id').value = invoiceId;
  document.getElementById('payment-amount').value = '';
  document.getElementById('payment-note').value = '';
  document.getElementById('payment-modal').style.display = 'flex';
}

function closePaymentModal() {
  document.getElementById('payment-modal').style.display = 'none';
}

document.getElementById('payment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const invoiceId = document.getElementById('payment-invoice-id').value;
  const data = {
    amount_paid: document.getElementById('payment-amount').value,
    note: document.getElementById('payment-note').value
  };

  try {
    const res = await fetch(`${API}/fees/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to record payment');
    }
    closePaymentModal();
    loadFees();
    loadDashboard();
  } catch (err) {
    alert(err.message || 'Failed to record payment');
  }
});

// --- Attendance ---
function ensureAttendanceDate() {
  const input = document.getElementById('attendance-date');
  if (!input.value) input.value = todayISO();
}

function onAttendanceSectionChange() {
  const section = document.getElementById('attendance-section').value;
  fillClassSelect(document.getElementById('attendance-class'), section, '', 'All Classes');
  loadAttendance();
}

async function loadAttendance() {
  try {
    ensureAttendanceDate();
    const date = document.getElementById('attendance-date').value;
    const section = document.getElementById('attendance-section').value;
    const classLevel = document.getElementById('attendance-class').value;

    let pupilUrl = `${API}/pupils?`;
    if (section) pupilUrl += `section=${encodeURIComponent(section)}&`;
    if (classLevel) pupilUrl += `class_level=${encodeURIComponent(classLevel)}&`;

    const [pupilRes, attendanceRes] = await Promise.all([
      fetch(pupilUrl),
      fetch(`${API}/attendance?date=${encodeURIComponent(date)}`)
    ]);
    const pupils = await pupilRes.json();
    const records = await attendanceRes.json();

    const recordMap = {};
    records.forEach(r => { recordMap[r.pupil_id] = r; });

    const tbody = document.getElementById('attendance-table-body');
    tbody.innerHTML = '';

    if (pupils.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No pupils match this filter.</td></tr>';
      loadAttendanceSummary(date);
      return;
    }

    const byClass = {};
    pupils.forEach(p => {
      const className = p.class_level || p.section;
      (byClass[className] = byClass[className] || []).push(p);
    });

    const classes = Object.keys(byClass).sort((a, b) => CLASS_ORDER.indexOf(a) - CLASS_ORDER.indexOf(b));

    classes.forEach(className => {
      const groupRow = document.createElement('tr');
      groupRow.className = 'group-row';
      groupRow.innerHTML = `<td colspan="3">${escapeHtml(className)}</td>`;
      tbody.appendChild(groupRow);

      byClass[className]
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .forEach(p => {
          const record = recordMap[p.id];
          const status = record ? record.status : '';
          const tr = document.createElement('tr');
          tr.className = status ? 'marked-row' : '';
          tr.innerHTML = `
            <td>${escapeHtml(p.full_name)}</td>
            <td>${escapeHtml(className)}</td>
            <td>
              <select class="attendance-select" data-pupil-id="${p.id}" onchange="saveAttendance(${p.id}, this.value, this)">
                <option value="" disabled ${!status ? 'selected' : ''}>Not marked</option>
                <option value="Present" ${status === 'Present' ? 'selected' : ''}>Present</option>
                <option value="Absent" ${status === 'Absent' ? 'selected' : ''}>Absent</option>
                <option value="Late" ${status === 'Late' ? 'selected' : ''}>Late</option>
              </select>
            </td>
          `;
          tbody.appendChild(tr);
        });
    });

    loadAttendanceSummary(date);
  } catch (err) {
    console.error(err);
    alert('Failed to load attendance');
  }
}

async function loadAttendanceSummary(date) {
  try {
    const res = await fetch(`${API}/attendance/summary/${date}`);
    const data = await res.json();

    const container = document.getElementById('attendance-summary');
    container.innerHTML = '';
    data.summary.forEach(s => {
      const unmarked = Math.max(0, s.total_pupils - s.total_marked);
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <h3>${s.section}</h3>
        <p class="summary-line"><span class="status-badge status-Present">${s.present}</span> Present</p>
        <p class="summary-line"><span class="status-badge status-Absent">${s.absent}</span> Absent</p>
        <p class="summary-line"><span class="status-badge status-Late">${s.late}</span> Late</p>
        <p class="summary-line muted">${unmarked} not marked / ${s.total_pupils} pupils</p>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    console.error(err);
  }
}

async function saveAttendance(pupilId, status, selectEl) {
  if (!status) return;
  const date = document.getElementById('attendance-date').value;
  try {
    const res = await fetch(`${API}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pupil_id: pupilId, attendance_date: date, status })
    });
    if (!res.ok) throw new Error('Failed to update attendance');
    if (selectEl) {
      selectEl.closest('tr').classList.add('marked-row');
      selectEl.classList.add('saved-flash');
      setTimeout(() => selectEl.classList.remove('saved-flash'), 700);
    }
    loadAttendanceSummary(date);
  } catch (err) {
    alert('Failed to update attendance');
  }
}

async function markAllPresent() {
  ensureAttendanceDate();
  const date = document.getElementById('attendance-date').value;
  const selects = Array.from(document.querySelectorAll('#attendance-table-body select[data-pupil-id]'));
  const pupilIds = selects.map(s => Number(s.dataset.pupilId));

  if (!pupilIds.length) {
    alert('There are no pupils to mark.');
    return;
  }
  if (!confirm(`Mark all ${pupilIds.length} pupil(s) present for ${date}?`)) return;

  try {
    const res = await fetch(`${API}/attendance/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pupil_ids: pupilIds, attendance_date: date, status: 'Present' })
    });
    if (!res.ok) throw new Error('Failed to save attendance');
    loadAttendance();
  } catch (err) {
    alert('Failed to save attendance');
  }
}

// --- Initialize ---
setEyeButton('dashboard');
setEyeButton('fees');
fillClassSelect(document.getElementById('filter-class'), '', '', 'All Classes');
fillClassSelect(document.getElementById('attendance-class'), '', '', 'All Classes');
ensureAttendanceDate();
loadDashboard();
