const API = '/api';

let currentUser = null;
const msgSelected = new Set();

// Wraps fetch so an expired session sends the user back to the login screen.
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    showAuthScreen();
    throw new Error('Your session has expired. Please log in again.');
  }
  return res;
}

// --- Auth screen ---
function showAuthError(message) {
  const box = document.getElementById('auth-error');
  box.textContent = message || '';
  box.hidden = !message;
}

function switchAuthTab(tab) {
  showAuthError('');
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.authTab === tab);
  });
  document.getElementById('login-form').hidden = tab !== 'login';
  document.getElementById('signup-form').hidden = tab !== 'signup';
}

function showAuthScreen() {
  currentUser = null;
  document.getElementById('app-header').hidden = true;
  document.getElementById('app-main').hidden = true;
  document.getElementById('auth-screen').hidden = false;
  document.body.classList.remove('role-admin', 'role-teacher');
  showAuthError('');
  switchAuthTab('login');
}

function enterApp(user) {
  currentUser = user;
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-header').hidden = false;
  document.getElementById('app-main').hidden = false;

  document.getElementById('user-name').textContent = user.full_name || user.email;
  const roleBadge = document.getElementById('user-role');
  roleBadge.textContent = user.role === 'admin' ? 'Admin' : 'Teacher';
  roleBadge.className = `user-role-badge role-${user.role}`;

  applyRoleUI(user);
  loadDashboard();
}

function applyRoleUI(user) {
  const isAdmin = user.role === 'admin';
  document.body.classList.toggle('role-admin', isAdmin);
  document.body.classList.toggle('role-teacher', !isAdmin);

  if (!isAdmin) {
    const activePage = document.querySelector('.page.active');
    if (activePage && (activePage.id === 'fees' || activePage.id === 'team' || activePage.id === 'messages')) {
      activatePage('dashboard');
    }
  }
}

function activatePage(section) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.section === section);
  });
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('active', page.id === section);
  });
  loadPageData(section);
}

async function checkAuth() {
  try {
    const res = await fetch(`${API}/auth/me`);
    if (!res.ok) {
      showAuthScreen();
      return;
    }
    const data = await res.json();
    enterApp(data.user);
  } catch (err) {
    showAuthScreen();
  }
}

async function logout() {
  try {
    await fetch(`${API}/auth/logout`, { method: 'POST' });
  } catch (err) {
    // Ignore network errors; the local session is cleared regardless.
  }
  showAuthScreen();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError('');

  const button = e.target.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to log in.');
    e.target.reset();
    enterApp(data.user);
  } catch (err) {
    showAuthError(err.message || 'Unable to log in.');
  } finally {
    button.disabled = false;
  }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showAuthError('');

  const password = document.getElementById('signup-password').value;
  const confirm = document.getElementById('signup-confirm').value;
  if (password !== confirm) {
    showAuthError('The two passwords do not match.');
    return;
  }

  const button = e.target.querySelector('button[type="submit"]');
  button.disabled = true;

  try {
    const res = await fetch(`${API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: document.getElementById('signup-name').value,
        email: document.getElementById('signup-email').value,
        password
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to create the account.');
    e.target.reset();
    enterApp(data.user);
  } catch (err) {
    showAuthError(err.message || 'Unable to create the account.');
  } finally {
    button.disabled = false;
  }
});

// --- Team accounts (admin only) ---
async function loadTeam() {
  try {
    const res = await apiFetch(`${API}/auth/users`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load accounts');

    const tbody = document.getElementById('team-table-body');
    tbody.innerHTML = '';

    data.users.forEach(user => {
      const isSelf = currentUser && user.id === currentUser.id;
      const joined = user.created_at ? new Date(user.created_at).toLocaleDateString() : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(user.full_name)}${isSelf ? ' <span class="badge badge-light">You</span>' : ''}</td>
        <td>${escapeHtml(user.email)}</td>
        <td>
          <select class="role-select" ${isSelf ? 'disabled title="You cannot change your own role"' : ''} onchange="changeUserRole('${user.id}', this.value, this)">
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="teacher" ${user.role === 'teacher' ? 'selected' : ''}>Teacher</option>
          </select>
        </td>
        <td>${escapeHtml(joined)}</td>
        <td class="row-actions">
          <button class="btn btn-sm btn-danger" ${isSelf ? 'disabled title="You cannot delete your own account"' : ''} onclick="removeUser('${user.id}', this)">Remove</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (!data.users.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No accounts found.</td></tr>';
    }
  } catch (err) {
    alert(err.message || 'Failed to load accounts');
  }
}

async function changeUserRole(userId, role, selectEl) {
  try {
    const res = await apiFetch(`${API}/auth/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update account');
    loadTeam();
  } catch (err) {
    alert(err.message || 'Failed to update account');
    if (selectEl) selectEl.value = selectEl.dataset.previous || selectEl.value;
    loadTeam();
  }
}

async function removeUser(userId, buttonEl) {
  if (!confirm('Remove this account? They will no longer be able to log in.')) return;
  if (buttonEl) buttonEl.disabled = true;

  try {
    const res = await apiFetch(`${API}/auth/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove account');
    loadTeam();
  } catch (err) {
    alert(err.message || 'Failed to remove account');
    if (buttonEl) buttonEl.disabled = false;
  }
}

// --- Input helpers ---
function digitsOnly(input) {
  const cleaned = input.value.replace(/\D/g, '').slice(0, 10);
  if (input.value !== cleaned) input.value = cleaned;
}


// --- Class definitions ---
const CLASS_LEVELS = {
  'Crèche': ['Crèche'],
  'Nursery': ['Nursery 1', 'Nursery 2'],
  'Kindergarten': ['Kindergarten 1', 'Kindergarten 2'],
  'Primary': ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']
};
const SECTION_ORDER = ['Crèche', 'Nursery', 'Kindergarten', 'Primary'];
const CLASS_ORDER = ['Crèche', 'Nursery 1', 'Nursery 2', 'Kindergarten 1', 'Kindergarten 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6'];

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

function formatDate(value) {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  const parts = text.split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return text;
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
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
  if (section === 'scores') loadScoresPage();
  if (section === 'team') loadTeam();
  if (section === 'messages') { loadMsgRecipients(); loadMsgHistory(); loadMsgConfig(); }
}

// --- Dashboard ---
async function loadDashboard() {
  try {
    const res = await apiFetch(`${API}/dashboard/summary`);
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

    const classBody = document.getElementById('class-table-body');
    classBody.innerHTML = '';
    (data.pupilsPerClass || []).forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(c.class_level)}</td><td>${escapeHtml(c.section)}</td><td>${c.count}</td>`;
      classBody.appendChild(tr);
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
    const gender = document.getElementById('filter-gender')?.value || '';
    const search = document.getElementById('filter-search').value;
    let url = `${API}/pupils?`;
    if (section) url += `section=${encodeURIComponent(section)}&`;
    if (classLevel) url += `class_level=${encodeURIComponent(classLevel)}&`;
    if (gender) url += `gender=${encodeURIComponent(gender)}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;

    const [pupilRes, requestRes] = await Promise.all([
      apiFetch(url),
      apiFetch(`${API}/pupils/delete-requests`).catch(() => null)
    ]);
    const pupils = await pupilRes.json();

    let requests = [];
    if (requestRes && requestRes.ok) {
      const payload = await requestRes.json();
      requests = payload.requests || [];
    }

    const pendingByPupil = {};
    requests
      .filter(request => request.status === 'Pending' && request.pupil_id)
      .forEach(request => { pendingByPupil[request.pupil_id] = request; });

    const tbody = document.getElementById('pupils-table-body');
    tbody.innerHTML = '';
    const isAdmin = currentUser && currentUser.role === 'admin';

    pupils.forEach(p => {
      const pending = pendingByPupil[p.id];
      const pendingBadge = pending
        ? ' <span class="badge badge-warning">Delete pending</span>'
        : '';

      const actions = isAdmin
        ? `<button class="btn btn-sm btn-primary" onclick="editPupil(${p.id})">Edit</button>
           <button class="btn btn-sm btn-danger" onclick="deletePupil(${p.id})">Delete</button>`
        : (pending
          ? '<span class="muted">Awaiting admin</span>'
          : `<button class="btn btn-sm btn-danger" onclick="requestDeletePupil(${p.id})">Request Delete</button>`);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.full_name)}${pendingBadge}</td>
        <td>${escapeHtml(p.gender || '')}</td>
        <td>${escapeHtml(p.class_level || p.section)}</td>
        <td>${escapeHtml(formatDate(p.date_of_birth))}</td>
        <td>${escapeHtml(p.guardian_name)}</td>
        <td>${escapeHtml(p.guardian_phone)}</td>
        <td><span class="status-badge status-${p.enrollment_status}">${escapeHtml(p.enrollment_status)}</span></td>
        <td class="row-actions">${actions}</td>
      `;
      tbody.appendChild(tr);
    });

    if (pupils.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No pupils found.</td></tr>';
    }

    renderDeleteRequests(requests);
  } catch (err) {
    console.error(err);
    alert('Failed to load pupils');
  }
}

function renderDeleteRequests(requests) {
  const panel = document.getElementById('delete-requests-panel');
  const list = document.getElementById('delete-requests-list');
  if (!panel || !list) return;

  if (!currentUser || currentUser.role !== 'admin') {
    panel.hidden = true;
    return;
  }

  const pending = requests.filter(request => request.status === 'Pending');
  if (!pending.length) {
    panel.hidden = true;
    list.innerHTML = '';
    return;
  }

  panel.hidden = false;
  list.innerHTML = pending.map(request => `
    <div class="delete-request-item">
      <div>
        <strong>${escapeHtml(request.pupil_name)}</strong>
        <span class="muted">${escapeHtml(request.pupil_class || '')}</span>
        <p class="muted">Requested by ${escapeHtml(request.requested_by_name || request.requested_by_email || 'a teacher')} on ${escapeHtml(formatDateTime(request.created_at))}</p>
        ${request.reason ? `<p class="delete-reason">&ldquo;${escapeHtml(request.reason)}&rdquo;</p>` : ''}
      </div>
      <div class="row-actions">
        <button class="btn btn-sm btn-success" onclick="approveDeleteRequest(${request.id})">Approve &amp; Delete</button>
        <button class="btn btn-sm btn-secondary" onclick="rejectDeleteRequest(${request.id})">Reject</button>
      </div>
    </div>
  `).join('');
}

async function requestDeletePupil(id) {
  const reason = prompt('Reason for deleting this pupil (optional):');
  if (reason === null) return;
  if (!confirm('Send a delete request to an administrator for approval?')) return;

  try {
    const res = await apiFetch(`${API}/pupils/${id}/delete-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send delete request');
    alert(data.message || 'Delete request sent to an administrator.');
    loadPupils();
  } catch (err) {
    alert(err.message || 'Failed to send delete request');
  }
}

async function approveDeleteRequest(requestId) {
  if (!confirm('Approve this request and permanently delete the pupil?')) return;
  try {
    const res = await apiFetch(`${API}/pupils/delete-requests/${requestId}/approve`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to approve delete request');
    alert(data.message || 'Pupil deleted.');
    loadPupils();
    loadDashboard();
  } catch (err) {
    alert(err.message || 'Failed to approve delete request');
  }
}

async function rejectDeleteRequest(requestId) {
  if (!confirm('Reject this delete request?')) return;
  try {
    const res = await apiFetch(`${API}/pupils/delete-requests/${requestId}/reject`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reject delete request');
    alert(data.message || 'Delete request rejected.');
    loadPupils();
  } catch (err) {
    alert(err.message || 'Failed to reject delete request');
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
    document.getElementById('pupil-date-of-birth').value = pupil.date_of_birth
      ? String(pupil.date_of_birth).slice(0, 10)
      : '';
    document.getElementById('pupil-gender').value = pupil.gender || '';
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
    const res = await apiFetch(`${API}/pupils/${id}`);
    const pupil = await res.json();
    openPupilModal(pupil);
  } catch (err) {
    alert('Failed to load pupil');
  }
}

async function deletePupil(id) {
  if (!confirm('Are you sure you want to delete this pupil?')) return;
  try {
    await apiFetch(`${API}/pupils/${id}`, { method: 'DELETE' });
    loadPupils();
    loadDashboard();
  } catch (err) {
    alert('Failed to delete pupil');
  }
}

document.getElementById('pupil-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('pupil-id').value;
  const phone = document.getElementById('pupil-guardian-phone').value.trim();
  if (!/^\d{10}$/.test(phone)) {
    alert('Guardian phone must be exactly 10 digits (numbers only).');
    return;
  }
  const pupilData = {
    full_name: document.getElementById('pupil-full-name').value,
    section: document.getElementById('pupil-section').value,
    class_level: document.getElementById('pupil-class').value,
    guardian_name: document.getElementById('pupil-guardian-name').value,
    guardian_phone: phone,
    date_of_birth: document.getElementById('pupil-date-of-birth').value || null,
    gender: document.getElementById('pupil-gender').value || null,
    enrollment_status: document.getElementById('pupil-enrollment-status').value
  };

  try {
    const res = await apiFetch(id ? `${API}/pupils/${id}` : `${API}/pupils`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pupilData)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to save pupil');
    if (result.warning) alert(result.warning);
    closePupilModal();
    loadPupils();
    loadDashboard();
  } catch (err) {
    alert(err.message || 'Failed to save pupil');
  }
});

// --- Fees ---
let feeInvoicesCache = [];
let receiptsCache = [];

async function loadFees() {
  try {
    const [invoiceRes, pupilRes, receiptRes] = await Promise.all([
      apiFetch(`${API}/fees`),
      apiFetch(`${API}/pupils`),
      apiFetch(`${API}/fees/receipts`)
    ]);
    const invoices = await invoiceRes.json();
    feeInvoicesCache = invoices;

    // Populate pupil dropdown in the individual invoice modal
    const pupils = await pupilRes.json();
    const pupilSelect = document.getElementById('invoice-pupil');
    pupilSelect.innerHTML = '';
    pupils.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.full_name} (${p.class_level || p.section})`;
      pupilSelect.appendChild(opt);
    });

    let receipts = [];
    if (receiptRes.ok) {
      const payload = await receiptRes.json();
      receipts = payload.receipts || (Array.isArray(payload) ? payload : []);
    }
    receiptsCache = receipts;

    // Summary totals
    const totalBilled = invoices.reduce((sum, inv) => sum + Number(inv.amount_billed || 0), 0);
    const totalCollected = invoices.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
    setMoneyElement(document.getElementById('fees-total-billed'), totalBilled);
    setMoneyElement(document.getElementById('fees-total-collected'), totalCollected);
    setMoneyElement(document.getElementById('fees-outstanding'), totalBilled - totalCollected);

    renderFeeGroups(invoices);
    renderReceipts(receipts);
  } catch (err) {
    console.error(err);
    alert('Failed to load fees');
  }
}

function renderReceipts(receipts) {
  const tbody = document.getElementById('receipts-table-body');
  const count = document.getElementById('receipts-count');
  if (count) {
    count.textContent = `${receipts.length} receipt${receipts.length === 1 ? '' : 's'}`;
  }
  if (!tbody) return;

  if (!receipts.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No payments recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = receipts.map(receipt => {
    const type = receipt.payment_type === 'Full' ? 'Paid' : 'Partial';
    return `
      <tr>
        <td>${escapeHtml(formatDate(receipt.paid_on))}</td>
        <td>${escapeHtml(receipt.receipt_number || '—')}</td>
        <td>${escapeHtml(receipt.pupil_name || '—')}</td>
        <td>${escapeHtml(receipt.pupil_class || '—')}</td>
        <td><span class="money" data-money-scope="fees" data-value="${Number(receipt.amount_paid || 0)}"></span></td>
        <td><span class="status-badge status-${type}">${escapeHtml(receipt.payment_type || 'Partial')}</span></td>
        <td><span class="money" data-money-scope="fees" data-value="${Number(receipt.balance_after || 0)}"></span></td>
        <td class="row-actions">
          <button class="btn btn-sm btn-primary" onclick="openReceiptModalById(${receipt.id})">Receipt</button>
        </td>
      </tr>
    `;
  }).join('');

  refreshAmounts('fees');
}

function openReceiptModalById(receiptId) {
  const receipt = receiptsCache.find(item => Number(item.id) === Number(receiptId));
  if (receipt) openReceiptModal(receipt);
}

function openReceiptModal(receipt) {
  if (!receipt) return;

  const area = document.getElementById('receipt-print-area');
  if (!area) return;

  const dateText = receipt.paid_on ? new Date(receipt.paid_on).toLocaleDateString() : new Date().toLocaleDateString();
  const balance = Number(receipt.balance_after || 0);
  const type = receipt.payment_type || (balance > 0 ? 'Partial' : 'Full');
  const termYear = [receipt.term, receipt.academic_year].filter(Boolean).join(' / ') || '—';

  area.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-logo">AK</div>
      <div>
        <h2>Agape Kiddie City Academy</h2>
        <p>Official Fee Receipt</p>
      </div>
    </div>
    <div class="receipt-meta">
      <div><span>Receipt No.</span><strong>${escapeHtml(receipt.receipt_number || 'Pending')}</strong></div>
      <div><span>Date Paid</span><strong>${escapeHtml(dateText)}</strong></div>
    </div>
    <table class="receipt-table">
      <tbody>
        <tr><th>Student</th><td>${escapeHtml(receipt.pupil_name || '—')}</td></tr>
        <tr><th>Class</th><td>${escapeHtml(receipt.pupil_class || '—')}</td></tr>
        <tr><th>Term / Year</th><td>${escapeHtml(termYear)}</td></tr>
        ${receipt.description ? `<tr><th>Description</th><td>${escapeHtml(receipt.description)}</td></tr>` : ''}
        <tr><th>Amount Billed</th><td>${formatMoney(receipt.amount_billed)}</td></tr>
        <tr><th>Amount Paid</th><td><strong>${formatMoney(receipt.amount_paid)}</strong></td></tr>
        <tr><th>Total Paid to Date</th><td>${formatMoney(receipt.total_paid)}</td></tr>
        <tr><th>Balance</th><td>${formatMoney(balance)}</td></tr>
        <tr><th>Payment Type</th><td>${escapeHtml(type)}</td></tr>
        ${receipt.note ? `<tr><th>Note</th><td>${escapeHtml(receipt.note)}</td></tr>` : ''}
        ${receipt.issued_by ? `<tr><th>Issued By</th><td>${escapeHtml(receipt.issued_by)}</td></tr>` : ''}
      </tbody>
    </table>
    <div class="receipt-footer">
      <div class="receipt-thanks">Thank you for your payment.</div>
      <div class="receipt-stamp"><span>School Stamp</span></div>
    </div>
    <p class="receipt-note">This receipt is valid only with the school stamp.</p>
  `;

  document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').style.display = 'none';
}

function printReceipt() {
  window.print();
}

function sectionForClass(className) {
  if (className.startsWith('Primary')) return 'Primary';
  if (className.startsWith('Kindergarten')) return 'Kindergarten';
  if (className.startsWith('Nursery')) return 'Nursery';
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

  const sectionSlugs = { 'Crèche': 'creche', 'Nursery': 'nursery', 'Kindergarten': 'kindergarten', 'Primary': 'primary' };
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
    const res = await apiFetch(`${API}/fees`, {
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
    const res = await apiFetch(`${API}/fees/bulk`, {
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
    await apiFetch(`${API}/fees/${id}`, { method: 'DELETE' });
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
    const res = await apiFetch(`${API}/fees/${invoiceId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to record payment');

    closePaymentModal();
    loadFees();
    loadDashboard();

    if (result.receipt) {
      openReceiptModal(result.receipt);
    } else if (result.setupRequired) {
      alert('Payment saved, but the receipts table is not set up yet. Run supabase/apply-updates.sql in Supabase to save receipts.');
    }
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
      apiFetch(pupilUrl),
      apiFetch(`${API}/attendance?date=${encodeURIComponent(date)}`)
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
      loadAttendanceHistory();
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
    loadAttendanceHistory();
  } catch (err) {
    console.error(err);
    alert('Failed to load attendance');
  }
}

async function loadAttendanceSummary(date) {
  try {
    const res = await apiFetch(`${API}/attendance/summary/${date}`);
    const data = await res.json();

    const container = document.getElementById('attendance-summary');
    container.innerHTML = '';
    data.summary.forEach(s => {
      const unmarked = Math.max(0, s.total_pupils - s.total_marked);
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = `
        <h3>${escapeHtml(s.section)}</h3>
        <p class="summary-line"><span class="status-badge status-Present">${s.present}</span> Present</p>
        <p class="summary-line"><span class="status-badge status-Absent">${s.absent}</span> Absent</p>
        <p class="summary-line"><span class="status-badge status-Late">${s.late}</span> Late</p>
        <p class="summary-line muted">${unmarked} not marked / ${s.total_pupils} pupils</p>
      `;
      container.appendChild(card);
    });

    const classContainer = document.getElementById('attendance-class-summary');
    if (classContainer) {
      classContainer.innerHTML = '';
      (data.classes || []).forEach(c => {
        const unmarked = Math.max(0, c.total_pupils - c.total_marked);
        const card = document.createElement('div');
        card.className = 'class-card';
        card.innerHTML = `
          <h4>${escapeHtml(c.class_level)}</h4>
          <p class="class-present"><strong>${c.present}</strong> present <span class="muted">/ ${c.total_pupils}</span></p>
          <p class="summary-line muted">${c.absent} absent &middot; ${c.late} late &middot; ${unmarked} unmarked</p>
        `;
        classContainer.appendChild(card);
      });
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadAttendanceHistory() {
  try {
    const res = await apiFetch(`${API}/attendance/analytics?days=14`);
    const data = await res.json();
    const tbody = document.getElementById('attendance-history-body');
    if (!tbody) return;

    const days = data.days || [];
    if (!days.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No attendance history yet.</td></tr>';
      return;
    }

    tbody.innerHTML = days.map(day => `
      <tr>
        <td>${escapeHtml(formatDate(day.date))}</td>
        <td>${day.present}</td>
        <td>${day.absent}</td>
        <td>${day.late}</td>
        <td>${day.marked}</td>
        <td>
          <span class="percent-bar"><span style="width:${Math.max(0, Math.min(100, day.percent_present))}%"></span></span>
          <span class="muted">${day.percent_present}%</span>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

async function saveAttendance(pupilId, status, selectEl) {
  if (!status) return;
  const date = document.getElementById('attendance-date').value;
  try {
    const res = await apiFetch(`${API}/attendance`, {
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
    loadAttendanceHistory();
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
    const res = await apiFetch(`${API}/attendance/bulk`, {
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

// --- Messages / SMS ---
function onMsgSectionChange() {
  const section = document.getElementById('msg-section').value;
  fillClassSelect(document.getElementById('msg-class'), section, '', 'All Classes');
  loadMsgRecipients();
}

async function loadMsgConfig() {
  try {
    const res = await apiFetch(`${API}/messages/config`);
    const data = await res.json();
    const input = document.getElementById('msg-sender');
    if (input && !input.value && data.defaultSender) input.value = data.defaultSender;
  } catch (err) {
    // ignore; sender can be typed manually
  }
}

async function loadMsgRecipients() {
  try {
    const section = document.getElementById('msg-section').value;
    const classLevel = document.getElementById('msg-class').value;
    const search = document.getElementById('msg-search').value;
    let url = `${API}/pupils?`;
    if (section) url += `section=${encodeURIComponent(section)}&`;
    if (classLevel) url += `class_level=${encodeURIComponent(classLevel)}&`;
    if (search) url += `search=${encodeURIComponent(search)}&`;

    const res = await apiFetch(url);
    const pupils = await res.json();

    const tbody = document.getElementById('msg-recipients-body');
    tbody.innerHTML = '';
    pupils.forEach(p => {
      const phone = p.guardian_phone || '';
      const checked = msgSelected.has(p.id) ? 'checked' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" data-pupil-id="${p.id}" ${checked} onchange="toggleMsgPupil(${p.id}, this.checked)" /></td>
        <td>${escapeHtml(p.full_name)}</td>
        <td>${escapeHtml(p.class_level || p.section)}</td>
        <td>${escapeHtml(p.guardian_name)}</td>
        <td>${escapeHtml(phone || '—')}</td>
      `;
      tbody.appendChild(tr);
    });

    if (pupils.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No pupils match this filter.</td></tr>';
    }

    updateMsgSelectAllState();
    updateMsgRecipientCount();
  } catch (err) {
    console.error(err);
    alert('Failed to load recipients');
  }
}

function toggleMsgPupil(id, checked) {
  if (checked) msgSelected.add(id);
  else msgSelected.delete(id);
  updateMsgSelectAllState();
  updateMsgRecipientCount();
}

function toggleMsgSelectAll(checked) {
  const boxes = document.querySelectorAll('#msg-recipients-body input[data-pupil-id]');
  boxes.forEach(box => {
    const id = Number(box.dataset.pupilId);
    box.checked = checked;
    if (checked) msgSelected.add(id);
    else msgSelected.delete(id);
  });
  updateMsgRecipientCount();
}

function updateMsgSelectAllState() {
  const boxes = document.querySelectorAll('#msg-recipients-body input[data-pupil-id]');
  const allChecked = boxes.length > 0 && Array.from(boxes).every(b => b.checked);
  const selectAll = document.getElementById('msg-select-all');
  if (selectAll) selectAll.checked = allChecked;
}

function updateMsgRecipientCount() {
  // Count unique phones among selected pupils (need pupil data; recompute from DOM is not enough).
  // We track selected ids; resolve phones by fetching cached pupil list is heavy. Instead, store a map.
  const count = msgSelected.size;
  const el = document.getElementById('msg-recipient-count');
  if (el) el.textContent = count + ' selected';
}

function updateMsgCounter() {
  const text = document.getElementById('msg-text').value || '';
  const chars = text.length;
  const parts = chars === 0 ? 0 : Math.ceil(chars / 160);
  document.getElementById('msg-char-count').textContent = chars;
  document.getElementById('msg-part-count').textContent = parts;
}

async function previewMsgRecipients() {
  if (msgSelected.size === 0) {
    alert('Select at least one recipient first.');
    return;
  }
  // Fetch full pupil list to resolve selected phones
  try {
    const res = await apiFetch(`${API}/pupils`);
    const pupils = await res.json();
    const selected = pupils.filter(p => msgSelected.has(p.id));
    // dedup by phone
    const seen = new Set();
    const rows = [];
    selected.forEach(p => {
      const key = String(p.guardian_phone || '').replace(/\\D/g, '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      rows.push(p);
    });

    const tbody = document.getElementById('msg-preview-body');
    tbody.innerHTML = rows.map(p => `
      <tr>
        <td>${escapeHtml(p.guardian_name)} <span class="muted">(${escapeHtml(p.full_name)})</span></td>
        <td>${escapeHtml(p.guardian_phone)}</td>
      </tr>
    `).join('');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="empty-cell">No recipients with phone numbers.</td></tr>';
    }
    document.getElementById('msg-preview-summary').textContent = rows.length + ' unique guardian(s) will receive this SMS.';
    document.getElementById('msg-preview-modal').style.display = 'flex';
  } catch (err) {
    alert('Failed to load recipients');
  }
}

function closeMsgPreviewModal() {
  document.getElementById('msg-preview-modal').style.display = 'none';
}

async function sendMessages() {
  const message = document.getElementById('msg-text').value.trim();
  if (!message) {
    alert('Please enter a message.');
    return;
  }
  if (msgSelected.size === 0) {
    alert('Select at least one recipient.');
    return;
  }

  try {
    const res = await apiFetch(`${API}/pupils`);
    const pupils = await res.json();
    const selected = pupils.filter(p => msgSelected.has(p.id));

    const seen = new Set();
    const recipients = [];
    selected.forEach(p => {
      const key = String(p.guardian_phone || '').replace(/\\D/g, '');
      if (!key || seen.has(key)) return;
      seen.add(key);
      recipients.push({ phone: p.guardian_phone, name: p.guardian_name, pupil_id: p.id });
    });

    if (!recipients.length) {
      alert('No valid recipient phone numbers among the selection.');
      return;
    }

    const sender = document.getElementById('msg-sender').value.trim();
    if (!confirm(`Send this SMS to ${recipients.length} recipient(s)?`)) return;

    const sendRes = await apiFetch(`${API}/messages/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients, message, sender: sender || null })
    });
    const result = await sendRes.json();
    if (!sendRes.ok) throw new Error(result.error || 'Failed to send SMS');

    alert(result.message || 'SMS sent.');
    document.getElementById('msg-text').value = '';
    updateMsgCounter();
    msgSelected.clear();
    document.querySelectorAll('#msg-recipients-body input[data-pupil-id]').forEach(b => { b.checked = false; });
    updateMsgRecipientCount();
    updateMsgSelectAllState();
    loadMsgHistory();
  } catch (err) {
    alert(err.message || 'Failed to send SMS');
  }
}

async function loadMsgHistory() {
  try {
    const res = await apiFetch(`${API}/messages/history`);
    const data = await res.json();
    if (data.setupRequired) {
      document.getElementById('msg-history-body').innerHTML = '<tr><td colspan="7" class="empty-cell">Messages are not set up in the database yet. Run supabase/apply-updates.sql.</td></tr>';
      return;
    }
    const campaigns = data.campaigns || [];
    const tbody = document.getElementById('msg-history-body');
    tbody.innerHTML = '';
    campaigns.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(formatDateTime(c.created_at))}</td>
        <td>${escapeHtml(c.sender || '—')}</td>
        <td>${escapeHtml((c.message || '').slice(0, 60))}${(c.message || '').length > 60 ? '…' : ''}</td>
        <td>${c.recipient_count}</td>
        <td><span class="status-badge status-${c.status === 'Sent' ? 'Paid' : 'Partial'}">${escapeHtml(c.status)}</span></td>
        <td>${escapeHtml(c.sent_by_name || c.sent_by_email || '—')}</td>
        <td class="row-actions"><button class="btn btn-sm btn-primary" onclick="viewMsgDetails(${c.id})">View</button></td>
      `;
      tbody.appendChild(tr);
    });
    if (campaigns.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No messages sent yet.</td></tr>';
    }
  } catch (err) {
    console.error(err);
  }
}

async function viewMsgDetails(id) {
  try {
    const res = await apiFetch(`${API}/messages/${id}`);
    const data = await res.json();
    const c = data.campaign;
    const recipients = data.recipients || [];
    const body = document.getElementById('msg-details-body');
    body.innerHTML = `
      <p><strong>Sent:</strong> ${escapeHtml(formatDateTime(c.created_at))}</p>
      <p><strong>Sender:</strong> ${escapeHtml(c.sender || '—')}</p>
      <p><strong>Status:</strong> ${escapeHtml(c.status)}</p>
      <p><strong>Sent by:</strong> ${escapeHtml(c.sent_by_name || c.sent_by_email || '—')}</p>
      <p><strong>Message:</strong></p>
      <div class="msg-detail-text">${escapeHtml(c.message)}</div>
      <h4 class="subheading">Recipients (${recipients.length})</h4>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Status</th></tr></thead>
          <tbody>
            ${recipients.map(r => `<tr><td>${escapeHtml(r.guardian_name || '—')}</td><td>${escapeHtml(r.phone)}</td><td>${escapeHtml(r.status)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('msg-details-modal').style.display = 'flex';
  } catch (err) {
    alert('Failed to load message details');
  }
}

function closeMsgDetailsModal() {
  document.getElementById('msg-details-modal').style.display = 'none';
}

// --- Initialize ---
setEyeButton('dashboard');
setEyeButton('fees');
fillClassSelect(document.getElementById('filter-class'), '', '', 'All Classes');
fillClassSelect(document.getElementById('attendance-class'), '', '', 'All Classes');
ensureAttendanceDate();
checkAuth();

// ---------------------------------------------------------------------------
// Scores & Reports
// ---------------------------------------------------------------------------
const scoreState = {
  term: '',
  year: '',
  components: [],
  gradeScale: [],
  hasComponents: false,
  period: null,
  sheet: null,
  reports: [],
  allSubjects: []
};

function defaultAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  const start = now.getMonth() >= 8 ? year : year - 1;
  return `${start}-${start + 1}`;
}

function ensureScorePeriod() {
  const termInput = document.getElementById('score-term');
  const yearInput = document.getElementById('score-year');
  if (!termInput.value) {
    termInput.value = localStorage.getItem('scoreTerm') || 'Term 1';
  }
  if (!yearInput.value) {
    yearInput.value = localStorage.getItem('scoreYear') || defaultAcademicYear();
  }
  scoreState.term = termInput.value.trim();
  scoreState.year = yearInput.value.trim();
}

function initScorePage() {
  ['score-class', 'report-class', 'setup-subject-class'].forEach(id => {
    const select = document.getElementById(id);
    if (select && select.options.length <= 1) {
      fillClassSelect(select, '', '', 'Select Class');
    }
  });
  ensureScorePeriod();
}

function activeScoreTab() {
  const tab = document.querySelector('.score-tab.active');
  return tab ? tab.dataset.scoreTab : 'entry';
}

function switchScoreTab(tab) {
  document.querySelectorAll('.score-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.scoreTab === tab);
  });
  document.querySelectorAll('.score-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `score-panel-${tab}`);
  });

  if (tab === 'entry') onScoreClassChange();
  if (tab === 'reports') loadReports();
  if (tab === 'setup') loadSetupPanel();
}

function loadScoresPage() {
  initScorePage();
  const tab = activeScoreTab();
  if (tab === 'entry') onScoreClassChange();
  if (tab === 'reports') loadReports();
  if (tab === 'setup') loadSetupPanel();
}

function onScorePeriodChange() {
  ensureScorePeriod();
  localStorage.setItem('scoreTerm', scoreState.term);
  localStorage.setItem('scoreYear', scoreState.year);
  const tab = activeScoreTab();
  if (tab === 'entry') onScoreClassChange();
  if (tab === 'reports') loadReports();
  if (tab === 'setup') loadSetupPanel();
}

function setScoreStatus(message, isError) {
  const el = document.getElementById('score-save-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('text-danger', Boolean(isError));
}

function showScoreSetupRequired(message) {
  const box = document.getElementById('score-setup-required');
  box.hidden = false;
  box.innerHTML = `<strong>Setup needed.</strong> ${escapeHtml(message)}`;
  document.getElementById('score-sheet-table').hidden = true;
}

function hideScoreSetupRequired() {
  document.getElementById('score-setup-required').hidden = true;
}

async function loadScoreSetup() {
  ensureScorePeriod();
  if (!scoreState.term || !scoreState.year) return null;

  const params = new URLSearchParams({
    term: scoreState.term,
    academic_year: scoreState.year
  });
  const res = await apiFetch(`${API}/scores/setup?${params.toString()}`);
  const data = await res.json();

  if (!res.ok) {
    if (data.setupRequired) {
      showScoreSetupRequired(data.error || 'Scores are not set up in the database yet.');
      return null;
    }
    throw new Error(data.error || 'Failed to load score setup');
  }

  hideScoreSetupRequired();
  scoreState.components = data.components || [];
  scoreState.gradeScale = data.grade_scale || [];
  scoreState.hasComponents = Boolean(data.has_components);
  scoreState.period = data.period || null;
  return data;
}

async function onScoreClassChange() {
  const classLevel = document.getElementById('score-class').value;
  const subjectSelect = document.getElementById('score-subject');
  subjectSelect.innerHTML = '<option value="">Select Subject</option>';

  if (!classLevel) {
    document.getElementById('score-sheet-table').hidden = true;
    scoreState.sheet = null;
    return;
  }

  try {
    const res = await apiFetch(`${API}/scores/subjects?class_level=${encodeURIComponent(classLevel)}`);
    const data = await res.json();
    if (data.setupRequired) {
      showScoreSetupRequired(data.error || 'Scores are not set up in the database yet.');
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Failed to load subjects');

    (data.subjects || []).forEach(subject => {
      const option = document.createElement('option');
      option.value = subject.id;
      option.textContent = subject.name;
      subjectSelect.appendChild(option);
    });

    if (!data.subjects || !data.subjects.length) {
      showScoreSetupRequired('No subjects are assigned to this class yet. An administrator can add them under Scores → Setup.');
      return;
    }

    hideScoreSetupRequired();

    const preferred = localStorage.getItem(`scoreSubject-${classLevel}`);
    if (preferred && (data.subjects || []).some(subject => String(subject.id) === preferred)) {
      subjectSelect.value = preferred;
    }
    if (subjectSelect.value) await loadScoreSheet();
  } catch (err) {
    setScoreStatus(err.message || 'Failed to load subjects', true);
  }
}

async function loadScoreSheet() {
  ensureScorePeriod();
  const classLevel = document.getElementById('score-class').value;
  const subjectId = document.getElementById('score-subject').value;
  const table = document.getElementById('score-sheet-table');
  setScoreStatus('');

  if (!classLevel || !subjectId) {
    table.hidden = true;
    scoreState.sheet = null;
    return;
  }

  localStorage.setItem(`scoreSubject-${classLevel}`, subjectId);

  try {
    const params = new URLSearchParams({
      term: scoreState.term,
      academic_year: scoreState.year,
      class_level: classLevel,
      subject_id: subjectId
    });
    const res = await apiFetch(`${API}/scores/sheet?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      if (data.setupRequired) {
        showScoreSetupRequired(data.error || 'Set up the assessment components first.');
        return;
      }
      throw new Error(data.error || 'Failed to load the score sheet');
    }

    hideScoreSetupRequired();
    scoreState.sheet = data;
    scoreState.components = data.components || [];
    scoreState.gradeScale = data.grade_scale || [];
    renderScoreSheet(data);
  } catch (err) {
    table.hidden = true;
    setScoreStatus(err.message || 'Failed to load the score sheet', true);
  }
}

function gradeForClient(score) {
  const scale = [...(scoreState.gradeScale || [])]
    .sort((a, b) => Number(b.min_score) - Number(a.min_score));
  return scale.find(item => Number(score) >= Number(item.min_score))
    || scale[scale.length - 1]
    || { grade: '-', remark: '' };
}

function renderScoreSheet(data) {
  const head = document.getElementById('score-sheet-head');
  const body = document.getElementById('score-sheet-body');
  const table = document.getElementById('score-sheet-table');

  head.innerHTML = '';

  const pupilHead = document.createElement('th');
  pupilHead.textContent = 'Pupil';
  head.appendChild(pupilHead);

  data.components.forEach(component => {
    const th = document.createElement('th');
    th.innerHTML = `${escapeHtml(component.name)}<span class="weight-tag">(/${Number(component.weight)})</span>`;
    head.appendChild(th);
  });

  ['Total', 'Grade', 'Remark', 'Actions'].forEach(label => {
    const th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  });

  body.innerHTML = '';

  if (!data.pupils || !data.pupils.length) {
    body.innerHTML = `<tr><td colspan="${data.components.length + 5}" class="empty-cell">No pupils in this class yet.</td></tr>`;
    table.hidden = false;
    return;
  }

  data.pupils.forEach(pupil => {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = pupil.full_name;
    tr.appendChild(nameCell);

    data.components.forEach(component => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'score-input';
      input.min = '0';
      input.max = String(Number(component.weight));
      input.step = '0.5';
      input.dataset.pupilId = pupil.pupil_id;
      input.dataset.componentId = component.id;
      input.dataset.weight = String(Number(component.weight));
      input.addEventListener('input', () => recalcScoreRow(input));

      const value = pupil.scores ? pupil.scores[component.id] : null;
      if (value !== null && value !== undefined) input.value = value;

      if (component.is_attendance) {
        input.title = `Auto-calculated from attendance (${pupil.attendance.present} of ${pupil.attendance.marked} days present). You can adjust it.`;
      }

      td.appendChild(input);
      tr.appendChild(td);
    });

    const totalCell = document.createElement('td');
    totalCell.className = 'score-total';
    tr.appendChild(totalCell);

    const gradeCell = document.createElement('td');
    gradeCell.className = 'score-grade';
    tr.appendChild(gradeCell);

    const remarkCell = document.createElement('td');
    remarkCell.className = 'score-remark';
    tr.appendChild(remarkCell);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'score-actions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn-sm';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => savePupilScores(pupil.pupil_id));
    const reportBtn = document.createElement('button');
    reportBtn.type = 'button';
    reportBtn.className = 'btn btn-sm btn-secondary';
    reportBtn.textContent = 'Report';
    reportBtn.addEventListener('click', () => generatePupilReport(pupil.pupil_id, pupil.full_name));
    actionsCell.appendChild(saveBtn);
    actionsCell.appendChild(reportBtn);
    tr.appendChild(actionsCell);

    body.appendChild(tr);
    recalcScoreRow(tr.querySelector('input[data-component-id]'));
  });

  table.hidden = false;
}

function recalcScoreRow(input) {
  if (!input) return;
  const tr = input.closest('tr');
  if (!tr) return;

  let total = 0;
  tr.querySelectorAll('input[data-component-id]').forEach(field => {
    if (field.value === '') return;
    const value = Number(field.value);
    if (Number.isFinite(value)) total += value;
  });

  total = Math.round(total * 10) / 10;
  const grade = gradeForClient(total);
  const totalCell = tr.querySelector('.score-total');
  const gradeCell = tr.querySelector('.score-grade');
  const remarkCell = tr.querySelector('.score-remark');

  if (totalCell) totalCell.textContent = total.toFixed(1);
  if (gradeCell) gradeCell.textContent = grade.grade;
  if (remarkCell) remarkCell.textContent = grade.remark || '';
}

async function saveScoreSheet() {
  if (!scoreState.sheet) {
    setScoreStatus('Choose a class and subject first.', true);
    return;
  }

  const classLevel = scoreState.sheet.class_level;
  const subjectId = scoreState.sheet.subject.id;
  const scores = [];

  document.querySelectorAll('#score-sheet-body input[data-component-id]').forEach(input => {
    if (input.value === '') return;
    scores.push({
      pupil_id: Number(input.dataset.pupilId),
      component_id: Number(input.dataset.componentId),
      score: Number(input.value)
    });
  });

  if (!scores.length) {
    setScoreStatus('There is nothing to save yet.', true);
    return;
  }

  setScoreStatus('Saving…');

  try {
    const res = await apiFetch(`${API}/scores/sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: scoreState.term,
        academic_year: scoreState.year,
        class_level: classLevel,
        subject_id: subjectId,
        scores
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save scores');

    setScoreStatus(`Saved ${data.saved} score${data.saved === 1 ? '' : 's'}.`);
  } catch (err) {
    setScoreStatus(err.message || 'Failed to save scores', true);
  }
}

async function savePupilScores(pupilId) {
  if (!scoreState.sheet) {
    setScoreStatus('Choose a class and subject first.', true);
    return;
  }
  const classLevel = scoreState.sheet.class_level;
  const subjectId = scoreState.sheet.subject.id;
  const scores = [];

  document.querySelectorAll(`#score-sheet-body input[data-component-id][data-pupil-id="${pupilId}"]`).forEach(input => {
    if (input.value === '') return;
    scores.push({
      pupil_id: Number(input.dataset.pupilId),
      component_id: Number(input.dataset.componentId),
      score: Number(input.value)
    });
  });

  if (!scores.length) {
    setScoreStatus('There is nothing to save for this pupil yet.', true);
    return;
  }

  setScoreStatus('Saving…');

  try {
    const res = await apiFetch(`${API}/scores/sheet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: scoreState.term,
        academic_year: scoreState.year,
        class_level: classLevel,
        subject_id: subjectId,
        scores
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save scores');
    setScoreStatus(`Saved ${data.saved} score${data.saved === 1 ? '' : 's'} for this pupil.`);
  } catch (err) {
    setScoreStatus(err.message || 'Failed to save scores', true);
  }
}

async function generatePupilReport(pupilId, pupilName) {
  ensureScorePeriod();
  const classLevel = document.getElementById('score-class').value;
  if (!classLevel) {
    setReportStatus('Choose a class first.', true);
    return;
  }
  if (!confirm(`Generate a report card for ${pupilName}?`)) return;

  setReportStatus('Generating…');

  try {
    const res = await apiFetch(`${API}/scores/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: scoreState.term,
        academic_year: scoreState.year,
        class_level: classLevel,
        pupil_ids: [Number(pupilId)]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate report card');
    setReportStatus(`${data.generated} report card(s) saved.${data.skipped ? ` (${data.skipped} without saved scores skipped)` : ''}`);
    // refresh reports list if on that tab
    if (document.getElementById('score-panel-reports').classList.contains('active')) {
      await loadReports();
    }
  } catch (err) {
    console.error('generatePupilReport error:', err);
    setReportStatus(err && err.message ? err.message : 'Failed to generate report card', true);
  }
}

// --- Score setup (admin) ---

function setSetupStatus(message, isError) {
  const el = document.getElementById('setup-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('text-danger', Boolean(isError));
}

async function loadSetupPanel() {
  initScorePage();
  setSetupStatus('');

  try {
    const data = await loadScoreSetup();
    if (!data) {
      setSetupStatus('Scores are not set up in the database yet. Run supabase/apply-updates.sql.', true);
    } else {
      setSetupStatus('');
    }
    renderComponentRows();
    renderGradeRows();
    loadSetupSubjects();

    const start = document.getElementById('setup-term-start');
    const end = document.getElementById('setup-term-end');
    if (scoreState.period) {
      start.value = scoreState.period.start_date || '';
      end.value = scoreState.period.end_date || '';
    } else {
      start.value = '';
      end.value = '';
    }
  } catch (err) {
    setSetupStatus(err.message || 'Failed to load the setup panel', true);
  }
}

function componentRow(component) {
  const tr = document.createElement('tr');
  if (component && component.id) tr.dataset.componentId = String(component.id);
  tr.innerHTML = `
    <td><input type="text" class="component-name" value="${escapeHtml(component ? component.name : '')}" placeholder="e.g. Homework" /></td>
    <td><input type="number" class="component-weight" min="0" max="100" step="0.5" value="${component ? Number(component.weight) : ''}" oninput="updateComponentsTotal()" /></td>
    <td class="center"><input type="checkbox" class="component-attendance" ${component && component.is_attendance ? 'checked' : ''} /></td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="removeComponentRow(this)">Remove</button></td>
  `;
  return tr;
}

function renderComponentRows() {
  const body = document.getElementById('components-body');
  body.innerHTML = '';

  const components = scoreState.components.length
    ? scoreState.components
    : [
      { name: 'Class Score', weight: 30, is_attendance: false },
      { name: 'Projects', weight: 10, is_attendance: false },
      { name: 'Attendance', weight: 10, is_attendance: true },
      { name: 'Exam', weight: 50, is_attendance: false }
    ];

  components.forEach(component => body.appendChild(componentRow(component)));
  updateComponentsTotal();
}

function addComponentRow() {
  document.getElementById('components-body').appendChild(componentRow(null));
  updateComponentsTotal();
}

function removeComponentRow(button) {
  const tr = button.closest('tr');
  if (tr) tr.remove();
  updateComponentsTotal();
}

function updateComponentsTotal() {
  let total = 0;
  document.querySelectorAll('#components-body .component-weight').forEach(input => {
    const value = Number(input.value);
    if (Number.isFinite(value)) total += value;
  });
  total = Math.round(total * 100) / 100;

  const el = document.getElementById('components-total');
  el.textContent = `Total: ${total}%`;
  el.classList.toggle('weight-ok', Math.abs(total - 100) < 0.01);
  el.classList.toggle('weight-bad', Math.abs(total - 100) >= 0.01);
}

async function saveComponents() {
  const components = [...document.querySelectorAll('#components-body tr')].map(tr => ({
    id: tr.dataset.componentId ? Number(tr.dataset.componentId) : null,
    name: tr.querySelector('.component-name').value.trim(),
    weight: Number(tr.querySelector('.component-weight').value),
    is_attendance: tr.querySelector('.component-attendance').checked
  })).filter(component => component.name || Number.isFinite(component.weight));

  try {
    const res = await apiFetch(`${API}/scores/setup/components`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: scoreState.term,
        academic_year: scoreState.year,
        components
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save components');

    scoreState.components = data.components || [];
    scoreState.hasComponents = scoreState.components.length > 0;
    renderComponentRows();
    setSetupStatus('Assessment components saved.');
  } catch (err) {
    setSetupStatus(err.message || 'Failed to save components', true);
  }
}

function gradeRow(grade) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="grade-label" maxlength="4" value="${escapeHtml(grade ? grade.grade : '')}" /></td>
    <td><input type="number" class="grade-min" min="0" max="100" step="1" value="${grade ? Number(grade.min_score) : ''}" /></td>
    <td><input type="text" class="grade-remark" value="${escapeHtml(grade ? grade.remark || '' : '')}" /></td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="removeGradeRow(this)">Remove</button></td>
  `;
  return tr;
}

function renderGradeRows() {
  const body = document.getElementById('grades-body');
  body.innerHTML = '';

  const scale = scoreState.gradeScale.length
    ? scoreState.gradeScale
    : [
      { grade: 'A', min_score: 80, remark: 'Excellent' },
      { grade: 'B', min_score: 70, remark: 'Very Good' },
      { grade: 'C', min_score: 60, remark: 'Good' },
      { grade: 'D', min_score: 50, remark: 'Credit' },
      { grade: 'E', min_score: 40, remark: 'Pass' },
      { grade: 'F', min_score: 0, remark: 'Fail' }
    ];

  scale.forEach(grade => body.appendChild(gradeRow(grade)));
}

function addGradeRow() {
  document.getElementById('grades-body').appendChild(gradeRow(null));
}

function removeGradeRow(button) {
  const tr = button.closest('tr');
  if (tr) tr.remove();
}

async function saveGrades() {
  const grades = [...document.querySelectorAll('#grades-body tr')].map(tr => ({
    grade: tr.querySelector('.grade-label').value.trim(),
    min_score: Number(tr.querySelector('.grade-min').value),
    remark: tr.querySelector('.grade-remark').value.trim()
  })).filter(grade => grade.grade);

  try {
    const res = await apiFetch(`${API}/scores/setup/grades`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grades })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save the grading scale');

    scoreState.gradeScale = data.grade_scale || [];
    setSetupStatus('Grading scale saved.');
  } catch (err) {
    setSetupStatus(err.message || 'Failed to save the grading scale', true);
  }
}

async function loadSetupSubjects() {
  const classLevel = document.getElementById('setup-subject-class').value;
  const list = document.getElementById('setup-subject-list');

  try {
    const [allRes, assignedRes] = await Promise.all([
      apiFetch(`${API}/scores/subjects`),
      classLevel
        ? apiFetch(`${API}/scores/subjects?class_level=${encodeURIComponent(classLevel)}`)
        : Promise.resolve(null)
    ]);

    if (!allRes.ok) {
      const data = await allRes.json();
      throw new Error(data.error || 'Failed to load subjects');
    }

    const allData = await allRes.json();
    scoreState.allSubjects = allData.subjects || [];

    const assigned = new Set();
    if (assignedRes && assignedRes.ok) {
      const assignedData = await assignedRes.json();
      (assignedData.subjects || []).forEach(subject => assigned.add(Number(subject.id)));
    }

    list.innerHTML = '';

    if (!scoreState.allSubjects.length) {
      list.innerHTML = '<p class="hint">No subjects yet. Add one below.</p>';
      return;
    }

    scoreState.allSubjects.forEach(subject => {
      const label = document.createElement('label');
      label.className = 'checkbox-label subject-choice';
      label.innerHTML = `
        <input type="checkbox" value="${subject.id}" ${assigned.has(Number(subject.id)) ? 'checked' : ''} ${classLevel ? '' : 'disabled'} />
        <span>${escapeHtml(subject.name)}</span>
        <button type="button" class="btn btn-sm btn-danger subject-delete" onclick="deleteSubject(${subject.id})" title="Delete this subject everywhere">&times;</button>
      `;
      list.appendChild(label);
    });
  } catch (err) {
    setSetupStatus(err.message || 'Failed to load subjects', true);
  }
}

async function addNewSubject() {
  const input = document.getElementById('new-subject-name');
  const name = input.value.trim();
  if (!name) {
    setSetupStatus('Enter a subject name first.', true);
    return;
  }

  try {
    const res = await apiFetch(`${API}/scores/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add the subject');

    input.value = '';
    setSetupStatus(`"${name}" added. Tick it for the class, then save.`);
    await loadSetupSubjects();
  } catch (err) {
    setSetupStatus(err.message || 'Failed to add the subject', true);
  }
}

async function deleteSubject(subjectId) {
  const subject = scoreState.allSubjects.find(item => Number(item.id) === Number(subjectId));
  const name = subject ? subject.name : 'this subject';
  if (!confirm(`Delete "${name}" everywhere? This also removes its saved scores.`)) return;

  try {
    const res = await apiFetch(`${API}/scores/subjects/${subjectId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove the subject');

    setSetupStatus(`"${name}" removed.`);
    await loadSetupSubjects();
  } catch (err) {
    setSetupStatus(err.message || 'Failed to remove the subject', true);
  }
}

async function saveClassSubjects() {
  const classLevel = document.getElementById('setup-subject-class').value;
  if (!classLevel) {
    setSetupStatus('Choose a class first.', true);
    return;
  }

  const subjectIds = [...document.querySelectorAll('#setup-subject-list input[type="checkbox"]:checked')]
    .map(input => Number(input.value));

  try {
    const res = await apiFetch(`${API}/scores/subjects/class`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class_level: classLevel, subject_ids: subjectIds })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save the class subjects');

    setSetupStatus(`${classLevel}: ${(data.subjects || []).length} subject(s) saved.`);
  } catch (err) {
    setSetupStatus(err.message || 'Failed to save the class subjects', true);
  }
}

async function saveTermPeriod() {
  const startDate = document.getElementById('setup-term-start').value;
  const endDate = document.getElementById('setup-term-end').value;

  try {
    const res = await apiFetch(`${API}/scores/setup/period`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: scoreState.term,
        academic_year: scoreState.year,
        start_date: startDate,
        end_date: endDate
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save the term dates');

    scoreState.period = data.period || null;
    setSetupStatus('Term dates saved.');
  } catch (err) {
    setSetupStatus(err.message || 'Failed to save the term dates', true);
  }
}

// --- Report cards ---

function setReportStatus(message, isError) {
  const el = document.getElementById('report-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('text-danger', Boolean(isError));
}

async function onReportClassChange() {
  await loadReportPupils();
  await loadReports();
}

async function loadReportPupils() {
  const select = document.getElementById('report-pupil');
  if (!select) return;
  const classLevel = document.getElementById('report-class').value;
  select.innerHTML = '<option value="">All pupils with scores</option>';
  if (!classLevel) return;
  try {
    const res = await apiFetch(`${API}/pupils?class_level=${encodeURIComponent(classLevel)}`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    data.forEach(pupil => {
      const option = document.createElement('option');
      option.value = pupil.id;
      option.textContent = pupil.full_name;
      select.appendChild(option);
    });
  } catch (err) {
    // ignore
  }
}

async function loadReports() {
  ensureScorePeriod();
  const classLevel = document.getElementById('report-class').value;
  setReportStatus('');

  if (!scoreState.term || !scoreState.year) return;

  try {
    const params = new URLSearchParams({
      term: scoreState.term,
      academic_year: scoreState.year
    });
    if (classLevel) params.set('class_level', classLevel);

    const res = await apiFetch(`${API}/scores/reports?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load report cards');

    scoreState.reports = data.reports || [];
    renderReports();
  } catch (err) {
    setReportStatus(err.message || 'Failed to load report cards', true);
  }
}

function renderReports() {
  const tbody = document.getElementById('reports-table-body');
  const isAdmin = currentUser && currentUser.role === 'admin';
  tbody.innerHTML = '';

  if (!scoreState.reports.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-cell">No report cards saved for this term yet.</td></tr>';
    return;
  }

  scoreState.reports.forEach(report => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(report.report_number || '—')}</td>
      <td>${escapeHtml(report.pupil_name || '—')}</td>
      <td>${escapeHtml(report.pupil_class || '—')}</td>
      <td>${escapeHtml([report.term, report.academic_year].filter(Boolean).join(' / '))}</td>
      <td>${Number(report.average_score || 0).toFixed(1)}</td>
      <td><span class="grade-badge">${escapeHtml(report.overall_grade || '—')}</span></td>
      <td>${Number(report.subject_count || 0)}</td>
      <td class="row-actions">
        <button type="button" class="btn btn-sm btn-primary" onclick="openReportById(${report.id})">Report</button>
        ${isAdmin ? `<button type="button" class="btn btn-sm btn-danger" onclick="deleteReport(${report.id})">Delete</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function generateReports() {
  ensureScorePeriod();
  const classLevel = document.getElementById('report-class').value;
  if (!classLevel) {
    setReportStatus('Choose a class first.', true);
    return;
  }
  const pupilId = document.getElementById('report-pupil').value;
  const scope = pupilId ? 'the selected pupil' : `pupils in ${classLevel} with saved scores`;
  if (!confirm(`Generate report cards for ${scope}? Saved reports for this term will be refreshed.`)) {
    return;
  }

  setReportStatus('Generating…');

  try {
    const body = {
      term: scoreState.term,
      academic_year: scoreState.year,
      class_level: classLevel
    };
    if (pupilId) body.pupil_ids = [Number(pupilId)];
    const res = await apiFetch(`${API}/scores/reports/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate report cards');

    await loadReports();
    const skipped = data.skipped ? ` (${data.skipped} without saved scores skipped)` : '';
    setReportStatus(`${data.generated} report card(s) saved.${skipped}`);
  } catch (err) {
    setReportStatus(err.message || 'Failed to generate report cards', true);
  }
}

async function openReportById(reportId) {
  try {
    const res = await apiFetch(`${API}/scores/reports/${reportId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load the report card');
    openReportModal(data.report);
  } catch (err) {
    alert(err.message || 'Failed to load the report card');
  }
}

function openReportModal(report) {
  if (!report) return;
  const snapshot = report.snapshot || {};
  const pupil = snapshot.pupil || {};
  const subjects = snapshot.subjects || [];
  const components = snapshot.components || [];
  const totals = snapshot.totals || {};
  const attendance = snapshot.attendance || {};
  const scale = snapshot.grading_scale || scoreState.gradeScale || [];
  const area = document.getElementById('report-print-area');

  if (!subjects.length) {
    area.innerHTML = '<p class="hint">This report has no subject rows. Regenerate it after entering scores.</p>';
    document.getElementById('report-modal').style.display = 'flex';
    return;
  }

  const headCells = components.map(component => `<th>${escapeHtml(component.name)}<span class="weight-tag">(/${Number(component.weight)})</span></th>`).join('');
  const subjectRows = subjects.map(subject => {
    const componentCells = components.map((component, index) => {
      const found = (subject.components || [])[index];
      const score = found ? Number(found.score) : 0;
      return `<td class="center">${score.toFixed(1)}</td>`;
    }).join('');

    return `
      <tr>
        <td class="subject-name">${escapeHtml(subject.subject_name)}</td>
        ${componentCells}
        <td class="center"><strong>${Number(subject.total).toFixed(1)}</strong></td>
        <td class="center"><span class="grade-badge">${escapeHtml(subject.grade)}</span></td>
        <td>${escapeHtml(subject.remark || '')}</td>
      </tr>
    `;
  }).join('');

  const scaleText = scale
    .map(item => `${escapeHtml(item.grade)} ${Number(item.min_score)}+`)
    .join(' · ');

  const termYear = [report.term, report.academic_year].filter(Boolean).join(' / ');
  const generated = report.generated_at ? new Date(report.generated_at).toLocaleDateString() : '';

  area.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-logo">AK</div>
      <div>
        <h2>Agape Kiddie City Academy</h2>
        <p>End of Term Report</p>
      </div>
    </div>

    <div class="receipt-meta">
      <div><span>Report No.</span><strong>${escapeHtml(report.report_number || 'Pending')}</strong></div>
      <div><span>Term</span><strong>${escapeHtml(termYear || '—')}</strong></div>
      <div><span>Class</span><strong>${escapeHtml(pupil.class_level || report.pupil_class || '—')}</strong></div>
      <div><span>Date</span><strong>${escapeHtml(generated || '—')}</strong></div>
    </div>

    <table class="receipt-table report-summary">
      <tr>
        <th>Pupil</th><td>${escapeHtml(pupil.name || report.pupil_name || '—')}</td>
        <th>Section</th><td>${escapeHtml(pupil.section || report.section || '—')}</td>
      </tr>
    </table>

    <table class="report-subjects">
      <thead>
        <tr>
          <th>Subject</th>
          ${headCells}
          <th>Total</th>
          <th>Grade</th>
          <th>Remark</th>
        </tr>
      </thead>
      <tbody>${subjectRows}</tbody>
    </table>

    <div class="report-totals">
      <div><span>Total Score</span><strong>${Number(totals.total || report.total_score || 0).toFixed(1)}</strong></div>
      <div><span>Average</span><strong>${Number(totals.average || report.average_score || 0).toFixed(1)}</strong></div>
      <div><span>Overall Grade</span><strong>${escapeHtml(totals.grade || report.overall_grade || '—')}</strong></div>
      <div><span>Attendance</span><strong>${Number(attendance.percent || report.attendance_percent || 0).toFixed(1)}%</strong></div>
    </div>

    <p class="report-scale">Grading scale: ${scaleText || '—'}</p>

    <div class="report-footer">
      <div class="report-signature"><span>Class Teacher</span></div>
      <div class="report-signature"><span>Head Teacher</span></div>
      <div class="receipt-stamp"><span>School Stamp</span></div>
    </div>
    <p class="receipt-note">This report is valid only with the school stamp.</p>
  `;

  document.getElementById('report-modal').style.display = 'flex';
}

function closeReportModal() {
  document.getElementById('report-modal').style.display = 'none';
}

function printReport() {
  window.print();
}

async function deleteReport(reportId) {
  if (!confirm('Delete this saved report card?')) return;

  try {
    const res = await apiFetch(`${API}/scores/reports/${reportId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete the report card');
    await loadReports();
  } catch (err) {
    alert(err.message || 'Failed to delete the report card');
  }
}

initScorePage();
