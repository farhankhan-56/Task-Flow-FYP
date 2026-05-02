/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — app.js
   ═══════════════════════════════════════════════════════════════ */

// ── API Configuration (same origin as HTML — works with LAN IPs & hosting)
const API_URL = `${window.location.origin.replace(/\/$/, '')}/api`;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Used by sidebar overlay onclick on all layout pages */
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}

// ── Fetch Helper ─────────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`;
  const defaults = {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'  // Include cookies for session
  };
  const config = { ...defaults, ...options };
  if (options.body && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }
  try {
    console.log(`📡 [API] ${config.method} ${endpoint}`);
    const res = await fetch(url, config);
    const text = await res.text();
    let data = {};
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        console.error(`❌ [API] Non-JSON response ${res.status} on ${endpoint}:`, text.slice(0, 200));
        throw { status: res.status, error: 'Server returned invalid data.', detail: text.slice(0, 120) };
      }
    } else if (!res.ok) {
      data = { error: `Request failed (${res.status})` };
    }

    if (!res.ok) {
      console.error(`❌ [API] Error ${res.status} on ${endpoint}:`, data);
      throw { status: res.status, ...(typeof data === 'object' ? data : { error: String(data) }) };
    }
    console.log(`✅ [API] Success ${endpoint}:`, data);
    return data;
  } catch (err) {
    if (err.status) throw err;
    console.error(`❌ [API] Fetch failed for ${endpoint}:`, err);
    throw err;
  }
}

// ── Auth ─────────────────────────────────────────────────────────
let _currentUser = null;
let _authCheckDone = false;

async function checkAuth() {
  if (_authCheckDone) return _currentUser;
  
  try {
    console.log('🔐 [AUTH] Checking session with server...');
    const res = await apiFetch('/auth/me');
    _currentUser = res.user;
    _authCheckDone = true;
    console.log('✅ [AUTH] User authenticated:', _currentUser.email);
    return _currentUser;
  } catch (err) {
    _currentUser = null;
    _authCheckDone = true;
    console.log('❌ [AUTH] Not authenticated');
    return null;
  }
}

async function getUser() {
  return await checkAuth();
}

function requireAuth() {
  // Note: getUser() is async; this helper must also be async.
  return getUser().then(user => {
    if (!user) window.location.href = 'index.html';
    return user;
  });
}

async function logout() {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout error:', err);
  }
  _currentUser = null;
  _authCheckDone = false;
  window.location.href = 'index.html';
}

// Login
async function handleLogin(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('l-email')?.value.trim();
  const pass = document.getElementById('l-pass')?.value;
  if (!email || !pass) { showToast('Please fill in all fields', 'error'); return; }
  
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: { email, password: pass }
    });
    _currentUser = res.user;
    showToast('Welcome back, ' + res.user.name + '!');
    setTimeout(() => window.location.href = 'dashboard.html', 700);
  } catch (err) {
    showToast(err.error || 'Login failed', 'error');
  }
}

// Signup
async function handleSignup(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('s-name')?.value.trim();
  const email = document.getElementById('s-email')?.value.trim();
  const pass = document.getElementById('s-pass')?.value;
  const confirm = document.getElementById('s-confirm')?.value;
  if (!name || !email || !pass || !confirm) { showToast('Please fill in all fields', 'error'); return; }
  if (pass.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
  if (pass !== confirm) { showToast('Passwords do not match', 'error'); return; }
  
  try {
    const res = await apiFetch('/auth/signup', {
      method: 'POST',
      body: { name, email, password: pass }
    });
    _currentUser = res.user;
    showToast('Account created! Welcome, ' + name + '!');
    setTimeout(() => window.location.href = 'dashboard.html', 700);
  } catch (err) {
    showToast(err.error || 'Signup failed', 'error');
  }
}

// ── Tasks ─────────────────────────────────────────────────────────
async function getTasks() {
  try {
    const res = await apiFetch('/tasks');
    return res.tasks || [];
  } catch (err) {
    console.error('Error fetching tasks:', err);
    return [];
  }
}

async function addTask(task) {
  try {
    const res = await apiFetch('/tasks', {
      method: 'POST',
      body: task
    });
    return res.task;
  } catch (err) {
    showToast(err.error || 'Failed to create task', 'error');
    throw err;
  }
}

async function updateTask(id, updates) {
  try {
    const res = await apiFetch(`/tasks/${id}`, {
      method: 'PUT',
      body: updates
    });
    return res.task;
  } catch (err) {
    showToast(err.error || 'Failed to update task', 'error');
    throw err;
  }
}

async function deleteTask(id) {
  try {
    await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
  } catch (err) {
    showToast(err.error || 'Failed to delete task', 'error');
    throw err;
  }
}

async function toggleTask(id) {
  try {
    const tasks = await getTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    
    const newStatus = task.status === 'complete' ? 'pending' : 'complete';
    await apiFetch(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    });
  } catch (err) {
    showToast(err.error || 'Failed to toggle task', 'error');
    throw err;
  }
}

async function markComplete(id) {
  try {
    await apiFetch(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: { status: 'complete' }
    });
  } catch (err) {
    showToast(err.error || 'Failed to mark complete', 'error');
    throw err;
  }
}

async function markPending(id) {
  try {
    await apiFetch(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: { status: 'pending' }
    });
  } catch (err) {
    showToast(err.error || 'Failed to mark pending', 'error');
    throw err;
  }
}

// ── Categories ────────────────────────────────────────────────────
async function getCats() {
  try {
    const res = await apiFetch('/categories');
    return res.categories || [];
  } catch (err) {
    console.error('Error fetching categories:', err);
    return [];
  }
}

async function addCat(cat) {
  try {
    const res = await apiFetch('/categories', {
      method: 'POST',
      body: cat
    });
    return res.category;
  } catch (err) {
    showToast(err.error || 'Failed to create category', 'error');
    throw err;
  }
}

async function deleteCat(id) {
  try {
    await apiFetch(`/categories/${id}`, { method: 'DELETE' });
  } catch (err) {
    showToast(err.error || 'Failed to delete category', 'error');
    throw err;
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(iso, status) {
  if (!iso || status === 'complete') return false;
  const due = new Date(iso);
  const now = new Date();
  due.setHours(23, 59, 59, 999);
  return due < now;
}

function getPriorityIcon(p) {
  if (p === 'high') return '<i class="fa-solid fa-circle-exclamation"></i>';
  if (p === 'medium') return '<i class="fa-solid fa-circle-half-stroke"></i>';
  return '<i class="fa-solid fa-circle-check"></i>';
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Sidebar rendering ─────────────────────────────────────────────
async function renderSidebarUser() {
  const user = await getUser(); if (!user) return;
  const av = document.getElementById('sb-avatar');
  const nm = document.getElementById('sb-name');
  const em = document.getElementById('sb-email');
  if (av) av.textContent = user.name.charAt(0).toUpperCase();
  if (nm) nm.textContent = user.name;
  if (em) em.textContent = user.email;
}

async function renderSidebarCats() {
  const list = document.getElementById('sidebar-cats'); if (!list) return;
  const cats = await getCats();
  if (!cats.length) {
    list.innerHTML = `<div style="padding:8px 10px;font-size:13px;color:var(--text-muted)">No categories yet</div>`;
    return;
  }
  const activeCat = new URLSearchParams(window.location.search).get('cat');
  list.innerHTML = cats.map(c => `
    <div class="cat-chip ${c.id === activeCat ? 'cat-active' : ''}" onclick="window.location.href='dashboard.html?cat=${encodeURIComponent(String(c.id))}'">
      <div class="cat-chip-left">
        <span class="cat-dot" style="background:${escapeHtml(c.color || '#4A90E2')}"></span>
        <span>${escapeHtml(c.name)}</span>
      </div>
      <button class="cat-del" onclick="event.stopPropagation();removeCat('${String(c.id).replace(/'/g, '\\\'')}')" title="Delete"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

async function removeCat(id) {
  await deleteCat(id);
  renderSidebarCats();
  showToast('Category removed');
}

async function updatePendingBadge() {
  const badge = document.getElementById('pending-badge'); if (!badge) return;
  const tasks = await getTasks();
  const count = tasks.filter(t => t.status === 'pending').length;
  badge.textContent = count;
  badge.style.display = count ? 'inline-flex' : 'none';
}

// ── Sidebar hamburger (mobile) ────────────────────────────────────
async function initSidebar() {
  await renderSidebarUser();
  await renderSidebarCats();
  await updatePendingBadge();

  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!hamburger || !sidebar) return;

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  });
}

// ── Category Modal ────────────────────────────────────────────────
function openCatModal() {
  document.getElementById('cat-modal')?.classList.add('open');
  setTimeout(() => document.getElementById('cat-name')?.focus(), 100);
}
function closeCatModal() {
  document.getElementById('cat-modal')?.classList.remove('open');
  const inp = document.getElementById('cat-name');
  if (inp) inp.value = '';
}
async function submitCat() {
  const name = document.getElementById('cat-name')?.value.trim();
  const color = document.getElementById('cat-color')?.value || '#4A90E2';
  if (!name) { showToast('Please enter a category name', 'error'); return; }
  try {
    await addCat({ name, color });
    await renderSidebarCats();
    closeCatModal();
    showToast('Category added!');
  } catch (err) {
    // Error already shown by addCat
  }
}

// ── Task Modal ────────────────────────────────────────────────────
let _editId = null;
let _deleteId = null;

async function populateCatSelect(selected = '') {
  const sel = document.getElementById('t-category'); if (!sel) return;
  const cats = await getCats();
  sel.innerHTML = `<option value="">No category</option>` +
    cats.map(c => `<option value="${String(c.id).replace(/"/g, '&quot;')}"${c.id === selected ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
}

function openAddTaskModal() {
  _editId = null;
  const title = document.getElementById('task-modal-title');
  const btn = document.getElementById('t-submit');
  if (title) title.textContent = 'Add New Task';
  if (btn) btn.textContent = 'Add Task';
  ['t-title', 't-desc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const due = document.getElementById('t-due'); if (due) due.value = '';
  const pri = document.getElementById('t-priority'); if (pri) pri.value = 'medium';
  populateCatSelect('');
  document.getElementById('task-modal')?.classList.add('open');
  setTimeout(() => document.getElementById('t-title')?.focus(), 100);
}

async function openEditTaskModal(id) {
  const tasks = await getTasks();
  const task = tasks.find(t => t.id === id); if (!task) return;
  _editId = id;
  const title = document.getElementById('task-modal-title');
  const btn = document.getElementById('t-submit');
  if (title) title.textContent = 'Edit Task';
  if (btn) btn.textContent = 'Save Changes';
  const tTitle = document.getElementById('t-title'); if (tTitle) tTitle.value = task.title;
  const tDesc = document.getElementById('t-desc'); if (tDesc) tDesc.value = task.description || '';
  const tDue = document.getElementById('t-due'); if (tDue) tDue.value = task.dueDate || '';
  const tPri = document.getElementById('t-priority'); if (tPri) tPri.value = task.priority;
  await populateCatSelect(task.category || '');
  document.getElementById('task-modal')?.classList.add('open');
}

function closeTaskModal() {
  document.getElementById('task-modal')?.classList.remove('open');
  _editId = null;
}

async function submitTask() {
  const title = document.getElementById('t-title')?.value.trim();
  const desc = document.getElementById('t-desc')?.value.trim();
  const dueDate = document.getElementById('t-due')?.value;
  const priority = document.getElementById('t-priority')?.value;
  const category = document.getElementById('t-category')?.value;
  if (!title) { showToast('Task title is required', 'error'); return; }
  
  try {
    if (_editId) {
      await updateTask(_editId, { title, description: desc, dueDate, priority, category });
      showToast('Task updated!');
    } else {
      await addTask({ title, description: desc, dueDate, priority, category });
      showToast('Task added!');
    }
    closeTaskModal();
    if (typeof renderPage === 'function') renderPage();
    await updatePendingBadge();
  } catch (err) {
    // Error already shown by updateTask/addTask
  }
}

// ── Delete Modal ──────────────────────────────────────────────────
function openDeleteModal(id) {
  _deleteId = id;
  document.getElementById('del-modal')?.classList.add('open');
}
function closeDeleteModal() {
  document.getElementById('del-modal')?.classList.remove('open');
  _deleteId = null;
}
async function confirmDelete() {
  if (!_deleteId) return;
  try {
    await deleteTask(_deleteId);
    closeDeleteModal();
    showToast('Task deleted');
    if (typeof renderPage === 'function') renderPage();
    await updatePendingBadge();
  } catch (err) {
    // Error already shown by deleteTask
  }
}

// ── Filter helpers ─────────────────────────────────────────────────
function setActiveFilter(clickedBtn) {
  const bar = clickedBtn.closest('.filter-bar');
  bar?.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  clickedBtn.classList.add('active');
}

// ── Task card HTML builder ─────────────────────────────────────────
function buildTaskCard(task, categories = [], options = {}) {
  const { showComplete = false, showRestore = false, showCheck = true } = options;
  const done = task.status === 'complete';
  const od = isOverdue(task.dueDate, task.status);
  const cat = categories.find(c => c.id === task.category);
  const safeId = escapeHtml(String(task.id));
  const tTitle = escapeHtml(task.title);
  const tDesc = escapeHtml(task.description || '');

  return `
  <div class="task-card ${od ? 'overdue' : ''} ${done ? 'completed' : ''}" id="tc-${safeId}">
    ${showCheck ? `<div class="task-check ${done ? 'checked' : ''}" onclick="doToggleTask('${safeId}')"></div>` : ''}
    <div class="task-body">
      <div class="task-title ${done ? 'done' : ''}">${tTitle}</div>
      ${task.description ? `<div class="task-desc">${tDesc}</div>` : ''}
      ${done && task.completedAt ? `<div class="completion-info"><i class="fa-solid fa-check"></i> Completed on ${escapeHtml(fmtDate(task.completedAt))}</div>` : ''}
      <div class="task-meta">
        <span class="badge badge-${task.priority}">${getPriorityIcon(task.priority)} ${task.priority}</span>
        ${cat ? `<span class="category-tag" style="background:${escapeHtml(cat.color)}18;color:${escapeHtml(cat.color)};border-color:${escapeHtml(cat.color)}33"><i class="fa-solid fa-folder"></i> ${escapeHtml(cat.name)}</span>` : ''}
      </div>
      <div class="task-footer-row">
        <span class="due-date ${od ? 'overdue' : ''}">
          ${od
      ? `<i class="fa-solid fa-triangle-exclamation"></i> Overdue: ${escapeHtml(fmtDate(task.dueDate))}`
      : task.dueDate
        ? `<i class="fa-regular fa-calendar"></i> Due: ${escapeHtml(fmtDate(task.dueDate))}`
        : `<span style="color:var(--text-muted);font-size:12px">No due date</span>`
    }
        </span>
        <div class="task-actions">
          ${showComplete ? `<button class="btn btn-complete" onclick="doCompleteTask('${safeId}')"><i class="fa-solid fa-check"></i> Complete</button>` : ''}
          ${showRestore ? `<button class="btn btn-restore"  onclick="doRestoreTask('${safeId}')"><i class="fa-solid fa-rotate-left"></i> Restore</button>` : ''}
          <button class="btn btn-edit"   onclick="openEditTaskModal('${safeId}')"><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="btn btn-delete" onclick="openDeleteModal('${safeId}')"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>
      </div>
    </div>
  </div>`;
}

function doToggleTask(id) {
  toggleTask(id).then(() => {
    updatePendingBadge();
    if (typeof renderPage === 'function') renderPage();
  });
}

function doCompleteTask(id) {
  markComplete(id).then(() => {
    showToast('Task marked as complete! ✅');
    updatePendingBadge();
    if (typeof renderPage === 'function') renderPage();
  });
}

function doRestoreTask(id) {
  markPending(id).then(() => {
    showToast('Task restored to pending');
    updatePendingBadge();
    if (typeof renderPage === 'function') renderPage();
  });
}

// ── Init on page load ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🔄 [INIT] DOMContentLoaded fired');

  if (window.location.protocol === 'file:') {
    showToast('Use the server URL (npm start → http://localhost:3000), not a file:/// path—the API requires the Node server.', 'error');
  }

  ['l-email', 'l-pass'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleLogin(e);
    })
  );

  ['s-name', 's-email', 's-pass', 's-confirm'].forEach(id =>
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleSignup(e);
    })
  );

  const page = window.location.pathname.split('/').pop();
  const publicPages = ['index.html', 'signup.html', 'forgot-password.html', 'reset-password.html', ''];
  const redirectToDashboardIfLoggedIn = ['index.html', 'signup.html', ''];
  console.log(`📄 Current page: ${page || 'root'}`);

  if (!publicPages.includes(page)) {
    console.log('🔐 Protected page - checking auth...');
    const user = await getUser();
    console.log(`👤 Auth check result:`, user);

    if (!user) {
      console.log('❌ No user found - redirecting to login');
      window.location.href = 'index.html';
      return;
    }
    console.log('✅ User authenticated - initializing sidebar');
    await initSidebar();
  } else if (redirectToDashboardIfLoggedIn.includes(page)) {
    const user = await getUser();
    if (user) {
      console.log('✅ Already logged in - redirecting to dashboard');
      window.location.href = 'dashboard.html';
    }
  }

  // Close modals on overlay click handled inline in HTML
  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeTaskModal();
      closeDeleteModal();
      closeCatModal();
    }
  });
});
