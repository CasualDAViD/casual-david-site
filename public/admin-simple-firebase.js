// Simple admin: Firebase Auth + Firestore + Cloudflare R2 uploads

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, updatePassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBHuDf1Yrbktjv15mFJtTdLd3YA2XCmDUs",
  authDomain: "casualdavid.com.ng",
  projectId: "casualdavid-site",
  storageBucket: "casualdavid-site.firebasestorage.app",
  messagingSenderId: "884094241084",
  appId: "1:884094241084:web:2ab1c7940ac014450cf639"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const MAIN_ADMIN = 'okpeidavid7@gmail.com';
const UPLOAD_URL = 'https://casualdavid-upload.okpeidavid7.workers.dev/';
const USERS_WORKER = 'https://casualdavid-admin-users.okpeidavid7.workers.dev/';

const MOD_SUBS = ['Utility', 'QoL', 'Transport', 'Performance', 'Building', 'Survival', 'Magic', 'Technology', 'Adventure', 'Decoration'];
const PLUGIN_SUBS = ['Utility', 'Economy', 'Protection', 'Minigames', 'Chat', 'World Management', 'Performance', 'Admin Tools', 'Gameplay'];

const ALL_PERMS = ['delete-mod', 'edit-mod', 'donate', 'socials', 'analytics', 'purchases', 'users', 'mods'];
const MOD_PERMS = ['mods', 'edit-mod', 'delete-mod', 'donate'];

const $ = (id) => document.getElementById(id);

let allPurchases = [];
let modNames = {};
let analyticsChart = null;
let analyticsData = { mods: [], purchases: [] };
let currentAdmin = null;

function showView(id) {
  ['loading-view', 'login-view', 'change-password-view', 'dashboard'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
}

function setMsg(id, text, ok) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = ok ? 'success' : 'error';
}

function isMainAdmin(user) {
  return user && (user.email || '').toLowerCase() === MAIN_ADMIN;
}

async function getAdminProfile(user) {
  if (!user) return null;
  if (isMainAdmin(user)) {
    return { email: user.email, role: 'main', permissions: ALL_PERMS, mustChangePassword: false };
  }
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    if (snap.exists()) return { uid: user.uid, ...snap.data() };
  } catch (e) {}
  return null;
}

function hasPerm(perm) {
  if (!currentAdmin) return false;
  if (currentAdmin.role === 'main') return true;
  return (currentAdmin.permissions || []).includes(perm);
}

function hasAnyModPerm() {
  return MOD_PERMS.some(p => hasPerm(p));
}

function applyPermissions() {
  document.querySelectorAll('.tabs button[data-perm]').forEach(btn => {
    const perm = btn.dataset.perm;
    let show = false;
    if (perm === 'mods') show = hasAnyModPerm();
    else show = hasPerm(perm);
    btn.classList.toggle('hidden', !show);
  });
  const donateLabel = $('donate-label');
  const donateInput = $('mod-donate');
  if (donateLabel && donateInput) {
    const show = hasPerm('donate');
    donateLabel.classList.toggle('hidden', !show);
    donateInput.classList.toggle('hidden', !show);
  }
}

function fillSubcategories(type, selected = []) {
  const container = $('mod-subcategory');
  const list = type === 'plugin' ? PLUGIN_SUBS : MOD_SUBS;
  const selectedArr = Array.isArray(selected) ? selected : (selected ? [selected] : []);
  container.innerHTML = list.map(s => `
    <label>
      <input type="checkbox" value="${s}" ${selectedArr.includes(s) ? 'checked' : ''}>
      ${s}
    </label>
  `).join('');
}

function getSelectedSubcategories() {
  return Array.from($('mod-subcategory').querySelectorAll('input:checked')).map(el => el.value);
}

function showScreenshotPreview(urls) {
  const box = $('screenshot-preview');
  if (!box) return;
  box.innerHTML = (urls || []).map(url => `<img src="${url}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;">`).join('');
}

$('mod-type').addEventListener('change', () => fillSubcategories($('mod-type').value));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentAdmin = null;
    showView('login-view');
    return;
  }
  const profile = await getAdminProfile(user);
  if (!profile) {
    setMsg('login-msg', 'This account is not an admin.');
    showView('login-view');
    return;
  }
  currentAdmin = profile;
  if (profile.mustChangePassword) {
    showView('change-password-view');
    return;
  }
  showView('dashboard');
  applyPermissions();
  fillSubcategories('mod');
  if (hasAnyModPerm()) loadMods();
  if (hasPerm('socials')) loadSocials();
});

$('google-btn').addEventListener('click', async () => {
  try { await signInWithPopup(auth, googleProvider); } catch (e) { setMsg('login-msg', e.message); }
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  btn.disabled = true;
  setMsg('login-msg', '');
  try {
    await signInWithEmailAndPassword(auth, $('login-email').value, $('login-password').value);
  } catch (err) {
    setMsg('login-msg', err.message);
    btn.disabled = false;
  }
});

$('change-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('new-password').value;
  const confirm = $('confirm-password').value;
  if (pw !== confirm) {
    setMsg('change-pw-msg', 'Passwords do not match.');
    return;
  }
  if (pw.length < 8) {
    setMsg('change-pw-msg', 'Password must be at least 8 characters.');
    return;
  }
  const btn = $('change-pw-btn');
  btn.disabled = true;
  setMsg('change-pw-msg', 'Saving…', true);
  try {
    await updatePassword(auth.currentUser, pw);
    await setDoc(doc(db, 'admins', auth.currentUser.uid), { mustChangePassword: false }, { merge: true });
    currentAdmin.mustChangePassword = false;
    setMsg('change-pw-msg', 'Password updated!', true);
    setTimeout(() => {
      showView('dashboard');
      applyPermissions();
      fillSubcategories('mod');
      if (hasAnyModPerm()) loadMods();
      if (hasPerm('socials')) loadSocials();
    }, 600);
  } catch (err) {
    setMsg('change-pw-msg', err.message || 'Failed to update password');
  } finally {
    btn.disabled = false;
  }
});

$('logout-btn').addEventListener('click', () => signOut(auth));

function showTab(tab) {
  if (tab === 'mods' && !hasAnyModPerm()) return;
  if (tab !== 'mods' && !hasPerm(tab)) return;
  ['mods', 'socials', 'analytics', 'purchases', 'users'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'analytics') loadAnalytics();
  if (tab === 'purchases') loadPurchases();
  if (tab === 'users') loadUsers();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

function collectPermissions() {
  const perms = [];
  if ($('perm-delete-mod')?.checked) perms.push('delete-mod');
  if ($('perm-edit-mod')?.checked) perms.push('edit-mod');
  if ($('perm-donate')?.checked) perms.push('donate');
  if ($('perm-socials')?.checked) perms.push('socials');
  if ($('perm-analytics')?.checked) perms.push('analytics');
  if ($('perm-purchases')?.checked) perms.push('purchases');
  return perms;
}

async function loadUsers() {
  const list = $('users-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const snap = await getDocs(collection(db, 'admins'));
    if (snap.empty) {
      list.innerHTML = '<p class="muted">No sub-users yet.</p>';
      return;
    }
    list.innerHTML = snap.docs.map(d => {
      const u = d.data();
      if (u.role === 'main') return '';
      const perms = (u.permissions || []).join(', ') || 'none';
      const status = u.mustChangePassword ? ' <span class="test-badge">temp password</span>' : '';
      return `<div class="user-item" data-uid="${d.id}">
        <div style="flex:1;">
          <strong>${u.email || d.id}</strong>${status}
          <div class="muted">${perms}</div>
          <div class="user-perms-edit hidden" id="edit-perms-${d.id}">
            <div class="perm-grid" style="margin:0.5rem 0;">
              <label><input type="checkbox" data-perm="delete-mod" ${ (u.permissions||[]).includes('delete-mod') ? 'checked' : '' }> Delete mod</label>
              <label><input type="checkbox" data-perm="edit-mod" ${ (u.permissions||[]).includes('edit-mod') ? 'checked' : '' }> Edit mod</label>
              <label><input type="checkbox" data-perm="donate" ${ (u.permissions||[]).includes('donate') ? 'checked' : '' }> Add donation link</label>
              <label><input type="checkbox" data-perm="socials" ${ (u.permissions||[]).includes('socials') ? 'checked' : '' }> Edit socials</label>
              <label><input type="checkbox" data-perm="analytics" ${ (u.permissions||[]).includes('analytics') ? 'checked' : '' }> View analytics</label>
              <label><input type="checkbox" data-perm="purchases" ${ (u.permissions||[]).includes('purchases') ? 'checked' : '' }> View purchases</label>
            </div>
            <button class="btn" style="padding:0.4rem 0.8rem;margin:0;" data-save-perms="${d.id}">Save</button>
            <button class="btn btn-plain" style="padding:0.4rem 0.8rem;margin:0;" data-cancel-perms="${d.id}">Cancel</button>
          </div>
        </div>
        <div style="display:flex; gap:0.4rem;">
          <button class="btn" style="padding:0.4rem 0.7rem;margin:0;" data-edit-perms="${d.id}">Edit</button>
          <button class="btn btn-danger" style="padding:0.4rem 0.7rem;margin:0;" data-del-user="${d.id}">Remove</button>
        </div>
      </div>`;
    }).filter(Boolean).join('') || '<p class="muted">No sub-users yet.</p>';

    list.querySelectorAll('[data-edit-perms]').forEach(b => b.addEventListener('click', () => {
      $('edit-perms-' + b.dataset.editPerms).classList.remove('hidden');
    }));
    list.querySelectorAll('[data-cancel-perms]').forEach(b => b.addEventListener('click', () => {
      $('edit-perms-' + b.dataset.cancelPerms).classList.add('hidden');
    }));
    list.querySelectorAll('[data-save-perms]').forEach(b => b.addEventListener('click', () => saveUserPerms(b.dataset.savePerms)));
    list.querySelectorAll('[data-del-user]').forEach(b => b.addEventListener('click', () => deleteUser(b.dataset.delUser)));
  } catch (err) {
    list.innerHTML = '<p class="error">' + (err.message || 'Failed to load users') + '</p>';
  }
}

async function saveUserPerms(uid) {
  const box = $('edit-perms-' + uid);
  const permissions = Array.from(box.querySelectorAll('input:checked')).map(el => el.dataset.perm);
  try {
    await setDoc(doc(db, 'admins', uid), { permissions }, { merge: true });
    loadUsers();
  } catch (err) {
    alert(err.message || 'Failed to save permissions');
  }
}

$('add-user-btn').addEventListener('click', async () => {
  const email = $('subuser-email').value.trim().toLowerCase();
  if (!email) {
    setMsg('user-msg', 'Enter an email.');
    return;
  }
  const permissions = collectPermissions();
  if (!permissions.length) {
    setMsg('user-msg', 'Select at least one permission.');
    return;
  }
  const btn = $('add-user-btn');
  btn.disabled = true;
  setMsg('user-msg', 'Creating user…', true);
  try {
    const res = await fetch(USERS_WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, permissions })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create user');
    setMsg('user-msg', data.message || 'User created and email sent!', true);
    $('subuser-email').value = '';
    document.querySelectorAll('#tab-users input[type="checkbox"]').forEach(el => el.checked = false);
    loadUsers();
  } catch (err) {
    setMsg('user-msg', err.message);
  } finally {
    btn.disabled = false;
  }
});

async function deleteUser(uid) {
  if (!confirm('Remove this user? They will no longer be able to access the admin page.')) return;
  try {
    await fetch(USERS_WORKER + '?uid=' + encodeURIComponent(uid), { method: 'DELETE' });
    await deleteDoc(doc(db, 'admins', uid));
    loadUsers();
  } catch (err) {
    alert(err.message || 'Failed to remove user');
  }
}

function getTimeframeStart(tf) {
  const now = Date.now();
  const day = 86400000;
  if (tf === 'today') return new Date().setHours(0,0,0,0);
  if (tf === 'yesterday') return new Date().setHours(0,0,0,0) - day;
  if (tf === '7') return now - 7 * day;
  if (tf === '30') return now - 30 * day;
  if (tf === '90') return now - 90 * day;
  return 0;
}

function getTimeframeEnd(tf) {
  if (tf === 'yesterday') return new Date().setHours(0,0,0,0);
  return Date.now();
}

function bucketKey(ts, group) {
  const d = new Date(ts);
  if (group === 'month') return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  if (group === 'week') {
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    return start.toISOString().slice(0,10);
  }
  return d.toISOString().slice(0,10);
}

function formatBucket(key, group) {
  if (group === 'month') {
    const [y, m] = key.split('-');
    return new Date(y, m-1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  return new Date(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function loadAnalytics() {
  try {
    const modsSnap = await getDocs(collection(db, 'mods'));
    const purchasesSnap = await getDocs(collection(db, 'purchases'));

    analyticsData.mods = [];
    modsSnap.forEach(d => analyticsData.mods.push({ id: d.id, ...d.data() }));

    analyticsData.purchases = [];
    purchasesSnap.forEach(d => analyticsData.purchases.push({ id: d.id, ...d.data() }));

    const projectSelect = $('analytics-project');
    const current = projectSelect.value;
    projectSelect.innerHTML = '<option value="all">All projects</option>' +
      analyticsData.mods.map(m => `<option value="${m.id}">${m.name || 'Mod'}</option>`).join('');
    if (current && [...projectSelect.options].some(o => o.value === current)) projectSelect.value = current;

    renderAnalytics();
  } catch (err) {
    $('mod-stats').innerHTML = '<p class="error">' + (err.message || 'Failed to load analytics') + '</p>';
  }
}

function renderAnalytics() {
  const projectId = $('analytics-project')?.value || 'all';
  const timeframe = $('analytics-timeframe')?.value || '30';
  const group = $('analytics-group')?.value || 'day';

  const start = getTimeframeStart(timeframe);
  const end = getTimeframeEnd(timeframe);

  const filteredPurchases = analyticsData.purchases.filter(p => {
    if (projectId !== 'all' && p.modId !== projectId) return false;
    const ts = p.paidAt || p.purchasedAt || 0;
    return ts >= start && ts <= end;
  });

  const filteredMods = projectId === 'all' ? analyticsData.mods : analyticsData.mods.filter(m => m.id === projectId);

  let totalViews = 0;
  let totalDownloads = 0;
  let totalRevenue = 0;
  const modMap = {};

  filteredMods.forEach(m => {
    modMap[m.id] = { name: m.name || 'Mod', views: m.views || 0, downloads: m.downloads || 0, purchases: 0, revenue: 0, testRevenue: 0 };
    totalViews += m.views || 0;
    totalDownloads += m.downloads || 0;
  });

  filteredPurchases.forEach(p => {
    const amt = Number(p.amount || 0);
    const isTest = p.test === true;
    if (modMap[p.modId]) {
      modMap[p.modId].purchases += 1;
      if (isTest) modMap[p.modId].testRevenue += amt;
      else {
        modMap[p.modId].revenue += amt;
        totalRevenue += amt;
      }
    }
  });

  $('stat-views').textContent = totalViews;
  $('stat-downloads').textContent = totalDownloads;
  $('stat-purchases').textContent = filteredPurchases.length;
  $('stat-revenue').textContent = '$' + totalRevenue.toFixed(2);

  const buckets = {};
  filteredPurchases.forEach(p => {
    const ts = p.paidAt || p.purchasedAt || 0;
    if (!ts) return;
    const key = bucketKey(ts, group);
    buckets[key] = (buckets[key] || 0) + 1;
  });
  const sortedKeys = Object.keys(buckets).sort();
  const labels = sortedKeys.map(k => formatBucket(k, group));
  const values = sortedKeys.map(k => buckets[k]);

  const ctx = document.getElementById('analytics-chart');
  if (analyticsChart) analyticsChart.destroy();
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  analyticsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['No data'],
      datasets: [{
        label: 'Purchases',
        data: values.length ? values : [0],
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: isDark ? '#94a3b8' : '#64748b' }, grid: { color: isDark ? '#334155' : '#e2e8f0' } },
        y: { beginAtZero: true, ticks: { color: isDark ? '#94a3b8' : '#64748b', precision: 0 }, grid: { color: isDark ? '#334155' : '#e2e8f0' } }
      }
    }
  });

  const box = $('mod-stats');
  const rows = Object.values(modMap).sort((a, b) => b.views - a.views);
  if (!rows.length) {
    box.innerHTML = '<p class="muted">No mods yet.</p>';
    return;
  }
  box.innerHTML = rows.map(m => {
    const testLabel = m.testRevenue > 0 ? ` <span style="color:#f59e0b;">test $${m.testRevenue.toFixed(2)}</span>` : '';
    return `
      <div class="mod-stat">
        <div><strong>${m.name}</strong></div>
        <div class="muted">${m.views} views • ${m.downloads} downloads • ${m.purchases} purchases • $${m.revenue.toFixed(2)}${testLabel}</div>
      </div>
    `;
  }).join('');
}

if ($('refresh-analytics')) $('refresh-analytics').addEventListener('click', loadAnalytics);
if ($('analytics-project')) $('analytics-project').addEventListener('change', renderAnalytics);
if ($('analytics-timeframe')) $('analytics-timeframe').addEventListener('change', renderAnalytics);
if ($('analytics-group')) $('analytics-group').addEventListener('change', renderAnalytics);

async function loadPurchases() {
  const list = $('purchase-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const modsSnap = await getDocs(collection(db, 'mods'));
    modNames = {};
    modsSnap.forEach(d => { modNames[d.id] = d.data().name || 'Mod'; });

    const snap = await getDocs(collection(db, 'purchases'));
    allPurchases = [];
    snap.forEach(d => {
      const p = d.data();
      allPurchases.push({
        id: d.id,
        displayName: p.displayName || '',
        email: p.email || '',
        modId: p.modId || '',
        modName: p.modName || modNames[p.modId] || 'Unknown mod',
        reference: p.reference || '',
        amount: Number(p.amount || 0),
        test: p.test === true,
        paidAt: p.paidAt || p.purchasedAt || 0
      });
    });

    allPurchases.sort((a, b) => b.paidAt - a.paidAt);
    renderPurchases();
  } catch (err) {
    list.innerHTML = '<p class="error">' + (err.message || 'Failed to load purchases') + '</p>';
  }
}

function renderPurchases() {
  const list = $('purchase-list');
  const q = ($('purchase-search')?.value || '').toLowerCase().trim();

  const filtered = allPurchases.filter(p => {
    if (!q) return true;
    return (
      (p.reference || '').toLowerCase().includes(q) ||
      (p.displayName || '').toLowerCase().includes(q) ||
      (p.email || '').toLowerCase().includes(q) ||
      (p.modName || '').toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    list.innerHTML = '<p class="muted">No purchases found.</p>';
    return;
  }

  list.innerHTML = filtered.map(p => {
    const date = p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '';
    const testBadge = p.test ? '<span class="test-badge">test</span>' : '';
    return `
      <div class="purchase-item">
        <div>
          <div><strong>${p.displayName || 'Unknown'}</strong> ${testBadge}</div>
          <div class="muted">${p.email || '—'}</div>
          <div class="muted" style="margin-top:0.25rem;">${p.modName}</div>
          <div class="ref" style="margin-top:0.3rem;">${p.reference || '—'}</div>
        </div>
        <div style="text-align:right;">
          <div>$${p.amount.toFixed(2)}</div>
          <div class="muted">${date}</div>
        </div>
      </div>
    `;
  }).join('');
}

if ($('purchase-search')) {
  $('purchase-search').addEventListener('input', renderPurchases);
}
if ($('refresh-purchases')) {
  $('refresh-purchases').addEventListener('click', loadPurchases);
}

function updatePreview() {
  const md = $('mod-desc').value || '';
  const html = md
    .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
  $('md-preview').innerHTML = html || '<span style="color:#94a3b8;">Preview will appear here</span>';
}
$('mod-desc').addEventListener('input', updatePreview);

document.querySelectorAll('.md-toolbar button').forEach((b) => {
  b.addEventListener('click', () => {
    const ta = $('mod-desc');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.slice(start, end);
    const pre = b.dataset.md || '', post = b.dataset.md2 || '';
    ta.value = ta.value.slice(0, start) + pre + sel + post + ta.value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + pre.length + sel.length;
    updatePreview();
  });
});

async function loadMods() {
  const list = $('admin-mod-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const snap = await getDocs(collection(db, 'mods'));
    if (snap.empty) {
      list.innerHTML = '<p class="muted">No mods yet.</p>';
      return;
    }
    const canEdit = hasPerm('edit-mod');
    const canDelete = hasPerm('delete-mod');
    list.innerHTML = snap.docs.map((d) => {
      const m = d.data();
      const versions = m.versions || [];
      const price = versions.length ? versions[0].price : (m.price || 0);
      const type = m.type || 'mod';
      const subs = Array.isArray(m.subcategories) ? m.subcategories.join(', ') : (m.subcategory || m.mainCategory || '');
      return `<div class="mod-item">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          ${m.icon ? `<img src="${m.icon}" class="preview-img">` : '<div class="preview-img"></div>'}
          <div>
            <strong>${m.name || ''}</strong>
            <div class="muted">$${Number(price).toFixed(2)} • ${type} / ${subs}</div>
          </div>
        </div>
        <div>
          ${canEdit ? `<button class="btn" style="padding:0.4rem 0.7rem;margin-right:0.4rem;" data-edit="${d.id}">Edit</button>` : ''}
          ${canDelete ? `<button class="btn btn-danger" style="padding:0.4rem 0.7rem;" data-delete="${d.id}">Delete</button>` : ''}
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editMod(b.dataset.edit)));
    list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteMod(b.dataset.delete)));
  } catch (err) {
    list.innerHTML = '<p class="error">Could not load mods. Check Firestore rules.</p>';
  }
}

async function uploadToR2(file) {
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': file.name
    },
    body: file
  });
  if (!res.ok) throw new Error('Upload failed');
  const data = await res.json();
  return data.url;
}

$('save-mod-btn').addEventListener('click', async () => {
  const name = $('mod-name').value.trim();
  const summary = $('mod-summary').value.trim();
  const description = $('mod-desc').value.trim();
  const thankYou = $('mod-thankyou').value.trim();
  const donateUrl = hasPerm('donate') ? $('mod-donate').value.trim() : undefined;
  const price = parseFloat($('mod-price').value);
  const type = $('mod-type').value;
  const subcategories = getSelectedSubcategories();
  const environment = $('mod-environment').value;
  const editId = $('edit-id').value || crypto.randomUUID();

  if (!name || !summary || isNaN(price)) {
    setMsg('mod-msg', 'Name, summary, and price are required.');
    return;
  }

  const btn = $('save-mod-btn');
  btn.disabled = true;
  setMsg('mod-msg', 'Saving…', true);

  try {
    const data = {
      name,
      summary,
      description,
      thankYou,
      price,
      type,
      subcategories,
      subcategory: subcategories[0] || '',
      environment,
      mainCategory: subcategories[0] || '',
      category: type,
      updatedAt: Date.now(),
      unlisted: false,
      views: 0,
      downloads: 0,
      versions: [{ name: '1.0', price, displayName: '', fileUrl: '', fileName: '' }]
    };
    if (donateUrl !== undefined) data.donateUrl = donateUrl;

    if ($('mod-icon').files[0]) {
      const url = await uploadToR2($('mod-icon').files[0]);
      if (url) data.icon = url;
    }

    const screenshotFiles = $('mod-screenshots').files;
    if (screenshotFiles && screenshotFiles.length) {
      const urls = [];
      for (const file of screenshotFiles) {
        const url = await uploadToR2(file);
        if (url) urls.push(url);
      }
      if (urls.length) data.screenshots = urls;
    }

    if ($('mod-file').files[0]) {
      const url = await uploadToR2($('mod-file').files[0]);
      if (url) {
        data.fileUrl = url;
        data.fileName = $('mod-file').files[0].name;
        data.versions[0].fileUrl = url;
        data.versions[0].fileName = $('mod-file').files[0].name;
      }
    }

    await setDoc(doc(db, 'mods', editId), data, { merge: true });
    setMsg('mod-msg', 'Saved!', true);
    $('edit-id').value = '';
    $('form-title').textContent = 'Add Mod';
    $('cancel-edit-btn').classList.add('hidden');
    $('mod-name').value = '';
    $('mod-summary').value = '';
    $('mod-desc').value = '';
    $('mod-thankyou').value = '';
    if ($('mod-donate')) $('mod-donate').value = '';
    $('mod-price').value = '';
    $('mod-type').value = 'mod';
    fillSubcategories('mod');
    $('mod-environment').value = 'client';
    $('mod-screenshots').value = '';
    showScreenshotPreview([]);
    updatePreview();
    loadMods();
  } catch (err) {
    setMsg('mod-msg', err.message);
  } finally {
    btn.disabled = false;
  }
});

async function editMod(id) {
  if (!hasPerm('edit-mod')) return;
  const snap = await getDoc(doc(db, 'mods', id));
  if (!snap.exists()) return;
  const m = snap.data();
  const versions = m.versions || [];
  const price = versions.length ? versions[0].price : (m.price || 0);
  $('edit-id').value = id;
  $('mod-name').value = m.name || '';
  $('mod-summary').value = m.summary || '';
  $('mod-desc').value = m.description || '';
  $('mod-thankyou').value = m.thankYou || '';
  if ($('mod-donate')) $('mod-donate').value = m.donateUrl || '';
  $('mod-price').value = price;
  $('mod-type').value = m.type || 'mod';
  const subs = Array.isArray(m.subcategories) ? m.subcategories : (m.subcategory ? [m.subcategory] : (m.mainCategory ? [m.mainCategory] : []));
  fillSubcategories(m.type || 'mod', subs);
  $('mod-environment').value = m.environment || 'client';
  showScreenshotPreview(m.screenshots || []);
  $('form-title').textContent = 'Edit Mod';
  $('cancel-edit-btn').classList.remove('hidden');
  updatePreview();
  window.scrollTo(0, 0);
}

$('cancel-edit-btn').addEventListener('click', () => {
  $('edit-id').value = '';
  $('form-title').textContent = 'Add Mod';
  $('cancel-edit-btn').classList.add('hidden');
  $('mod-name').value = '';
  $('mod-summary').value = '';
  $('mod-desc').value = '';
  $('mod-thankyou').value = '';
  if ($('mod-donate')) $('mod-donate').value = '';
  $('mod-price').value = '';
  $('mod-type').value = 'mod';
  fillSubcategories('mod');
  $('mod-environment').value = 'client';
  $('mod-screenshots').value = '';
  showScreenshotPreview([]);
  updatePreview();
});

async function deleteMod(id) {
  if (!hasPerm('delete-mod')) return;
  if (!confirm('Delete this mod?')) return;
  await deleteDoc(doc(db, 'mods', id));
  loadMods();
}

const SOCIAL = {
  youtube: 'yt-url', tiktok: 'tt-url', discord: 'dc-url', modrinth: 'mr-url',
  curseforge: 'cf-url', personalDiscord: 'pd-url', email: 'em-url', donate: 'dn-url'
};

async function loadSocials() {
  try {
    const snap = await getDoc(doc(db, 'config', 'socials'));
    if (!snap.exists()) return;
    const s = snap.data();
    for (const [k, id] of Object.entries(SOCIAL)) if ($(id)) $(id).value = s[k] || '';
  } catch (e) {}
}

$('save-socials-btn').addEventListener('click', async () => {
  const data = {};
  for (const [k, id] of Object.entries(SOCIAL)) data[k] = $(id).value.trim();
  await setDoc(doc(db, 'config', 'socials'), data);
  setMsg('social-msg', 'Social links saved!', true);
});
