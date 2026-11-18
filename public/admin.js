// Admin dashboard. Everything is saved on the server; sign-in is a normal
// account with the "admin" role (create one with `npm run create-admin`).

const $ = (id) => document.getElementById(id);
let modsCache = [];

function showView(id) {
  ['loading-view', 'login-view', 'dashboard'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
}

function setMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text || '';
  el.className = ok ? 'success' : 'error';
}

// ---- sign in -------------------------------------------------------------

async function enterIfAdmin(user) {
  if (!user) { showView('login-view'); return false; }
  if (user.role !== 'admin') {
    setMsg('login-msg', 'This account is not an admin. Sign in with the admin account.');
    showView('login-view');
    return false;
  }
  showView('dashboard');
  showTab('mods');
  loadModsList();
  loadSocialsForm();
  return true;
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-btn');
  btn.disabled = true;
  setMsg('login-msg', '');
  try {
    const r = await api('/api/auth/login', { method: 'POST', json: {
      email: $('login-email').value,
      password: $('login-password').value
    }});
    $('login-password').value = '';
    await enterIfAdmin(r.user);
  } catch (err) {
    setMsg('login-msg', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  setMsg('login-msg', '');
  showView('login-view');
});

// If the session ends while the dashboard is open, go back to the login form.
function handleApiError(err, msgId) {
  if (err.status === 401 || err.status === 403) {
    setMsg('login-msg', 'Your session ended. Please sign in again.');
    showView('login-view');
    return;
  }
  setMsg(msgId, err.message);
}

// ---- tabs ----------------------------------------------------------------

function showTab(tab) {
  ['mods', 'orders', 'socials', 'account'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'orders') loadOrders();
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- mods ----------------------------------------------------------------

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadModsList() {
  const list = $('admin-mod-list');
  try {
    modsCache = (await api('/api/admin/mods')).mods;
  } catch (err) {
    handleApiError(err, 'mod-msg');
    return;
  }
  if (modsCache.length === 0) {
    list.innerHTML = '<p class="muted">No mods yet. Add one above.</p>';
    return;
  }
  list.innerHTML = modsCache.map((m) => `
    <div class="mod-item">
      <div style="display:flex; align-items:center; gap:0.75rem;">
        ${m.icon ? `<img src="${escapeHtml(m.icon)}" class="preview-img" alt="">` : '<div class="preview-img"></div>'}
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          <div class="muted">$${Number(m.price).toFixed(2)} • ${m.sales} sold</div>
          <div class="muted">${m.available
            ? 'File: ' + escapeHtml(m.fileName || 'uploaded') + (m.fileSize ? ' (' + formatSize(m.fileSize) + ')' : '')
            : '<span style="color:#b45309;">No file uploaded yet (shown as Coming soon)</span>'}</div>
        </div>
      </div>
      <div>
        <button class="btn" style="padding:0.4rem 0.7rem; margin-right:0.4rem;" data-edit="${escapeHtml(m.id)}">Edit</button>
        <button class="btn btn-danger" style="padding:0.4rem 0.7rem;" data-delete="${escapeHtml(m.id)}">Delete</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editMod(b.dataset.edit)));
  list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteMod(b.dataset.delete)));
}

function previewFiles(input, target) {
  target.innerHTML = '';
  Array.from(input.files).forEach((file) => {
    const img = document.createElement('img');
    img.className = 'preview-img';
    img.style.margin = '0.25rem';
    img.src = URL.createObjectURL(file);
    target.appendChild(img);
  });
}
$('mod-icon').addEventListener('change', (e) => previewFiles(e.target, $('icon-preview')));
$('mod-screens').addEventListener('change', (e) => previewFiles(e.target, $('screens-preview')));

function resetForm() {
  ['mod-name', 'mod-desc', 'mod-price', 'edit-id'].forEach((id) => { $(id).value = ''; });
  $('mod-category').value = 'Mod';
  ['mod-icon', 'mod-screens', 'mod-file'].forEach((id) => { $(id).value = ''; });
  $('icon-preview').innerHTML = '';
  $('screens-preview').innerHTML = '';
  $('form-title').textContent = 'Add Mod';
  $('save-mod-btn').textContent = 'Save Mod';
  $('cancel-edit-btn').classList.add('hidden');
  $('file-info').textContent = 'Allowed: .jar, .zip, .mrpack, .mcpack, .mcaddon, .7z, .rar. Only people who have paid can download it. Until a file is uploaded, the mod shows as "Coming soon".';
}
$('cancel-edit-btn').addEventListener('click', () => { resetForm(); setMsg('mod-msg', ''); });

// Sends the form with a progress bar (fetch cannot report upload progress).
function sendForm(method, url, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('progress-bar').style.width = Math.round((e.loaded / e.total) * 100) + '%';
    };
    xhr.onload = () => {
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error(data.message || 'Could not save the mod.');
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('Could not reach the server. Check your connection and try again.'));
    xhr.send(formData);
  });
}

$('save-mod-btn').addEventListener('click', async () => {
  const name = $('mod-name').value.trim();
  const description = $('mod-desc').value.trim();
  const price = $('mod-price').value;
  const editId = $('edit-id').value;

  if (!name || !description || !price) {
    setMsg('mod-msg', 'Name, description, and price are required.');
    return;
  }

  const fd = new FormData();
  fd.append('name', name);
  fd.append('description', description);
  fd.append('category', $('mod-category').value);
  fd.append('price', price);
  if ($('mod-icon').files[0]) fd.append('icon', $('mod-icon').files[0]);
  Array.from($('mod-screens').files).forEach((f) => fd.append('screenshots', f));
  if ($('mod-file').files[0]) fd.append('file', $('mod-file').files[0]);

  const btn = $('save-mod-btn');
  btn.disabled = true;
  $('progress-bar').style.width = '0';
  $('progress').classList.remove('hidden');
  setMsg('mod-msg', 'Saving…', true);
  try {
    await sendForm(editId ? 'PUT' : 'POST', editId ? '/api/admin/mods/' + encodeURIComponent(editId) : '/api/admin/mods', fd);
    setMsg('mod-msg', 'Mod saved!', true);
    resetForm();
    loadModsList();
  } catch (err) {
    handleApiError(err, 'mod-msg');
  } finally {
    btn.disabled = false;
    $('progress').classList.add('hidden');
  }
});

function editMod(id) {
  const m = modsCache.find((x) => x.id === id);
  if (!m) return;
  resetForm();
  $('edit-id').value = m.id;
  $('mod-name').value = m.name;
  $('mod-desc').value = m.description;
  $('mod-price').value = m.price;
  $('mod-category').value = m.category || 'Mod';
  $('form-title').textContent = 'Edit Mod';
  $('save-mod-btn').textContent = 'Save Changes';
  $('cancel-edit-btn').classList.remove('hidden');
  $('file-info').textContent = m.available
    ? 'Current file: ' + (m.fileName || 'uploaded') + (m.fileSize ? ' (' + formatSize(m.fileSize) + ')' : '') + '. Choose a new file only if you want to replace it.'
    : 'No file uploaded yet. Choose one to make this mod available to buy.';
  $('icon-preview').innerHTML = m.icon ? `<img src="${escapeHtml(m.icon)}" class="preview-img" style="margin-top:0.5rem;" alt=""> <span class="muted">Current icon. Choose a new image to replace it.</span>` : '';

  const shots = $('screens-preview');
  shots.innerHTML = (m.screenshots || []).map((src, i) => `
    <span class="shot"><img src="${escapeHtml(src)}" class="preview-img" alt="">
      <button type="button" title="Remove screenshot" data-shot="${m.screenshotIds[i]}">×</button></span>`).join('');
  shots.querySelectorAll('[data-shot]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remove this screenshot?')) return;
    try {
      await api('/api/admin/mods/' + encodeURIComponent(m.id) + '/screenshots/' + b.dataset.shot, { method: 'DELETE' });
      b.parentElement.remove();
      loadModsList();
    } catch (err) {
      handleApiError(err, 'mod-msg');
    }
  }));
  showTab('mods');
  window.scrollTo(0, 0);
}

async function deleteMod(id) {
  const m = modsCache.find((x) => x.id === id);
  if (!confirm('Delete "' + (m ? m.name : 'this mod') + '"? It will disappear from the shop. People who already bought it keep their download.')) return;
  try {
    await api('/api/admin/mods/' + encodeURIComponent(id), { method: 'DELETE' });
    if ($('edit-id').value === id) resetForm();
    loadModsList();
  } catch (err) {
    handleApiError(err, 'mod-msg');
  }
}

// ---- orders --------------------------------------------------------------

async function loadOrders() {
  const box = $('orders-box');
  box.innerHTML = '<p class="muted">Loading…</p>';
  let orders;
  try {
    orders = (await api('/api/admin/orders')).orders;
  } catch (err) {
    handleApiError(err, 'mod-msg');
    return;
  }
  if (orders.length === 0) { box.innerHTML = '<p class="muted">No orders yet.</p>'; return; }
  box.innerHTML = `<table class="orders"><thead><tr>
      <th>Date</th><th>Buyer</th><th>Item</th><th>Amount</th><th>Status</th><th>Reference</th>
    </tr></thead><tbody>${orders.map((o) => `<tr>
      <td>${new Date((o.paidAt || o.createdAt) * 1000).toLocaleString()}</td>
      <td>${escapeHtml(o.userName)}<br><span class="muted">${escapeHtml(o.email)}</span></td>
      <td>${escapeHtml(o.modName)}</td>
      <td>${formatKobo(o.amountKobo)}</td>
      <td><span class="pill ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span></td>
      <td class="muted">${escapeHtml(o.reference)}</td>
    </tr>`).join('')}</tbody></table>`;
}

// ---- social links --------------------------------------------------------

const SOCIAL_FIELDS = {
  youtube: 'yt-url', youtubeHandle: 'yt-handle', tiktok: 'tt-url', tiktokHandle: 'tt-handle',
  discord: 'dc-url', modrinth: 'mr-url', curseforge: 'cf-url', personalDiscord: 'pd-url',
  email: 'em-url', donate: 'dn-url'
};

async function loadSocialsForm() {
  try {
    const s = await api('/api/socials');
    for (const [key, id] of Object.entries(SOCIAL_FIELDS)) $(id).value = s[key] || '';
  } catch (err) {
    handleApiError(err, 'social-msg');
  }
}

$('save-socials-btn').addEventListener('click', async () => {
  const body = {};
  for (const [key, id] of Object.entries(SOCIAL_FIELDS)) body[key] = $(id).value.trim();
  try {
    await api('/api/admin/socials', { method: 'PUT', json: body });
    setMsg('social-msg', 'Social links saved!', true);
  } catch (err) {
    handleApiError(err, 'social-msg');
  }
});

// ---- account -------------------------------------------------------------

$('change-pw-btn').addEventListener('click', async () => {
  const np = $('new-password').value;
  if (np !== $('confirm-password').value) { setMsg('pw-msg', 'Passwords do not match.'); return; }
  try {
    await api('/api/auth/change-password', { method: 'POST', json: {
      currentPassword: $('current-password').value,
      newPassword: np
    }});
    ['current-password', 'new-password', 'confirm-password'].forEach((id) => { $(id).value = ''; });
    setMsg('pw-msg', 'Password updated.', true);
  } catch (err) {
    handleApiError(err, 'pw-msg');
  }
});

// ---- start ---------------------------------------------------------------

getMe().then(enterIfAdmin);
