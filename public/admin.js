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

// ---- projects (list + create/edit wizard) --------------------------------

const STEPS = ['general', 'description', 'files', 'license'];
let catalog = null;
let wz = null; // state of the project being created or edited

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadCatalog() {
  if (!catalog) catalog = (await getConfig()).catalog;
  return catalog;
}

function showProjects() {
  $('wizard').classList.add('hidden');
  $('projects-view').classList.remove('hidden');
  wz = null;
  window.scrollTo(0, 0);
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
    list.innerHTML = '<div class="empty-state"><p>No projects yet.</p></div>';
    return;
  }
  list.innerHTML = modsCache.map((m) => `
    <div class="mod-item">
      <div class="mod-meta">
        ${m.icon ? `<img src="${escapeHtml(m.icon)}" class="preview-img" alt="">` : '<div class="preview-img"></div>'}
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          ${m.unlisted ? '<span class="pill unlisted">Unlisted</span>' : ''}
          ${m.available ? '' : '<span class="pill nofile">No file</span>'}
          <div class="muted">${escapeHtml(m.class || '')} &bull; ${escapeHtml(m.mainCategory || '')} &bull; $${Number(m.price).toFixed(2)} &bull; ${m.sales} sold</div>
          <div class="muted">${escapeHtml(m.summary || '')}</div>
        </div>
      </div>
      <div class="mod-actions">
        <button class="btn" data-edit="${escapeHtml(m.id)}">Edit</button>
        <button class="btn btn-danger" data-delete="${escapeHtml(m.id)}">Delete</button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openWizard(b.dataset.edit)));
  list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteMod(b.dataset.delete)));
}

// ---- wizard ----------------------------------------------------------------

function fillSelect(sel, options, current) {
  sel.innerHTML = options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  if (current && options.includes(current)) sel.value = current;
}

async function openWizard(id) {
  try { await loadCatalog(); } catch (err) { handleApiError(err, 'mod-msg'); return; }
  const m = id ? modsCache.find((x) => x.id === id) : null;
  if (id && !m) return;
  const firstClass = Object.keys(catalog.classes)[0];

  wz = {
    id: m ? m.id : null,
    step: 0,
    logoFile: null,
    logoUrl: m ? m.icon : null,
    modFile: null,
    existingFile: m && m.available ? { name: m.fileName, size: m.fileSize } : null,
    newShots: [], // { file, url }
    shots: m ? (m.screenshots || []).map((src, i) => ({ id: m.screenshotIds[i], src, removed: false })) : [],
    extra: m ? [...(m.categories || [])] : [],
    links: m ? (m.links || []).map((l) => ({ ...l })) : [],
    busy: false
  };
  const cls = m && m.class ? m.class : firstClass;

  $('wz-title').textContent = m ? 'Edit Project' : 'Create Project';
  $('p-name').value = m ? m.name : '';
  $('p-summary').value = m ? m.summary || '' : '';
  $('p-description').value = m ? m.description || '' : '';
  $('p-price').value = m ? Number(m.price).toFixed(2) : '';
  $('p-unlisted').checked = !!(m && m.unlisted);
  $('p-logo').value = '';
  $('p-file').value = '';
  $('p-shots').value = '';
  fillSelect($('p-class'), Object.keys(catalog.classes), cls);
  fillCategorySelects(m ? m.mainCategory : null);
  fillSelect($('p-license'), catalog.licenses.map((l) => l.name), m && m.license ? m.license.name : 'All Rights Reserved');
  document.querySelectorAll('#wizard .invalid').forEach((el) => el.classList.remove('invalid'));
  $('wz-msg').textContent = '';
  $('wz-progress').classList.add('hidden');
  $('wz-banner').classList.toggle('hidden', !!m);
  ['wz-save', 'wz-submit', 'wz-next', 'wz-prev'].forEach((bid) => { $(bid).disabled = false; });

  renderLogo(); renderChips(); renderLinks(); renderFileCard(); renderGallery(); renderLicenseLink();
  updateCounters(); updatePreview();
  $('projects-view').classList.add('hidden');
  $('wizard').classList.remove('hidden');
  goStep(0);
  window.scrollTo(0, 0);
}

function fillCategorySelects(mainCurrent) {
  const cats = catalog.classes[$('p-class').value] || [];
  fillSelect($('p-main'), cats, mainCurrent);
  refreshExtraSelect();
}

function refreshExtraSelect() {
  const cats = catalog.classes[$('p-class').value] || [];
  const main = $('p-main').value;
  wz.extra = wz.extra.filter((c) => cats.includes(c) && c !== main);
  const room = wz.extra.length < catalog.limits.extraCategories;
  const choices = cats.filter((c) => c !== main && !wz.extra.includes(c));
  const sel = $('p-extra-add');
  sel.innerHTML = `<option value="">${room ? 'Add a category…' : 'Limit reached'}</option>` +
    choices.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.disabled = !room || choices.length === 0;
  renderChips();
}

function renderChips() {
  const box = $('p-extra-chips');
  box.innerHTML = wz.extra.map((c, i) =>
    `<span class="wz-chip">${escapeHtml(c)}<button type="button" data-rm="${i}" aria-label="Remove ${escapeHtml(c)}">&times;</button></span>`).join('');
  box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    wz.extra.splice(Number(b.dataset.rm), 1);
    refreshExtraSelect();
  }));
}

function renderLogo() {
  const box = $('p-logo-box');
  box.innerHTML = wz.logoUrl ? `<img src="${escapeHtml(wz.logoUrl)}" alt="Logo preview">` : '&#128230;';
}

function renderLinks() {
  const box = $('p-links');
  const types = catalog.linkTypes;
  box.innerHTML = wz.links.map((l, i) => `
    <div class="wz-link-row" data-i="${i}">
      <select class="lk-type" aria-label="Link type">${types.map((t) => `<option${t === l.type ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>
      <input type="text" class="lk-url" value="${escapeHtml(l.url || '')}" placeholder="https://" aria-label="Link address">
      <button type="button" class="wz-icon-btn" aria-label="Remove link">&#128465;</button>
    </div>`).join('');
  box.querySelectorAll('.wz-link-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('.lk-type').addEventListener('change', (e) => { wz.links[i].type = e.target.value; });
    row.querySelector('.lk-url').addEventListener('input', (e) => { wz.links[i].url = e.target.value; e.target.classList.remove('invalid'); });
    row.querySelector('button').addEventListener('click', () => { wz.links.splice(i, 1); renderLinks(); });
  });
  $('p-add-link').disabled = wz.links.length >= catalog.limits.links;
}

function renderFileCard() {
  const f = wz.modFile ? { name: wz.modFile.name, size: wz.modFile.size, fresh: true } : wz.existingFile;
  $('p-file-name').textContent = f ? (f.name || 'uploaded file') + (f.size ? ' (' + formatSize(f.size) + ')' : '') : 'No file uploaded yet';
  $('p-file-sub').textContent = f
    ? (f.fresh ? 'Will be uploaded when you save.' : 'Choose a new file only if you want to replace it.')
    : 'Without a file the project shows as "Coming soon".';
}

function renderGallery() {
  const g = $('p-gallery');
  const old = wz.shots.map((s, i) => s.removed ? '' :
    `<div class="wz-thumb"><img src="${escapeHtml(s.src)}" alt=""><button type="button" data-old="${i}" aria-label="Remove image">&times;</button></div>`).join('');
  const fresh = wz.newShots.map((s, i) =>
    `<div class="wz-thumb new"><img src="${escapeHtml(s.url)}" alt=""><button type="button" data-new="${i}" aria-label="Remove image">&times;</button></div>`).join('');
  g.innerHTML = old + fresh;
  g.querySelectorAll('[data-old]').forEach((b) => b.addEventListener('click', () => { wz.shots[Number(b.dataset.old)].removed = true; renderGallery(); }));
  g.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    const [s] = wz.newShots.splice(Number(b.dataset.new), 1);
    URL.revokeObjectURL(s.url);
    renderGallery();
  }));
}

function renderLicenseLink() {
  const l = catalog.licenses.find((x) => x.name === $('p-license').value);
  const a = $('p-license-link');
  a.classList.toggle('hidden', !l || !l.url);
  if (l && l.url) a.href = l.url;
}

function updateCounters() {
  $('p-name-count').textContent = $('p-name').value.length;
  $('p-summary-count').textContent = $('p-summary').value.length;
  $('p-desc-count').textContent = $('p-description').value.length;
}

let previewTimer = null;
function updatePreview() {
  const src = $('p-description').value;
  $('p-preview').innerHTML = src.trim() ? renderMarkdown(src) : '<p class="placeholder">Nothing to preview yet.</p>';
}

// ---- steps and navigation ---------------------------------------------------

function goStep(i) {
  wz.step = i;
  STEPS.forEach((s, n) => $('step-' + s).classList.toggle('hidden', n !== i));
  document.querySelectorAll('#wz-steps button').forEach((b, n) => b.classList.toggle('active', n === i));
  const editing = !!wz.id;
  const last = i === STEPS.length - 1;
  $('wz-prev').disabled = i === 0;
  $('wz-next').classList.toggle('hidden', last);
  $('wz-submit').classList.toggle('hidden', !last || editing);
  $('wz-save').classList.toggle('hidden', !editing);
  $('wz-submit').textContent = 'Create';
  setWzMsg('');
  window.scrollTo(0, 0);
}

function setWzMsg(text, ok) {
  const el = $('wz-msg');
  el.textContent = text || '';
  el.className = 'wz-msg ' + (ok ? 'success' : 'error');
}

function flag(el, bad) { el.classList.toggle('invalid', !!bad); return !bad; }

// Returns an error message (and marks the field) or '' when the step is fine.
function validateStep(name) {
  const lim = catalog.limits;
  if (name === 'general') {
    const nm = $('p-name').value.trim();
    if (!flag($('p-name'), !nm || nm.length > lim.name)) return 'Enter a project name.';
    if (!wz.logoFile && !wz.logoUrl) return 'Upload a logo for the project.';
    const sm = $('p-summary').value.trim();
    if (!flag($('p-summary'), !sm || sm.length > lim.summary)) return 'Enter a short summary.';
    if (!$('p-main').value) return 'Choose a main category.';
    for (const row of document.querySelectorAll('.wz-link-row')) {
      const i = Number(row.dataset.i);
      const url = (wz.links[i].url || '').trim();
      if (url && !/^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(url)) {
        flag(row.querySelector('.lk-url'), true);
        return 'One of the social links is not a valid web address.';
      }
    }
  }
  if (name === 'description') {
    const d = $('p-description').value.trim();
    if (!flag($('p-description'), !d || d.length > lim.description)) return 'Write a description.';
  }
  if (name === 'files') {
    const p = parseFloat($('p-price').value);
    if (!flag($('p-price'), !(p > 0))) return 'Enter a price above $0.';
  }
  return '';
}

function tryNext() {
  const err = validateStep(STEPS[wz.step]);
  if (err) { setWzMsg(err); return; }
  goStep(Math.min(wz.step + 1, STEPS.length - 1));
}

function buildFormData() {
  const fd = new FormData();
  fd.append('name', $('p-name').value.trim());
  fd.append('summary', $('p-summary').value.trim());
  fd.append('description', $('p-description').value.trim());
  fd.append('class', $('p-class').value);
  fd.append('mainCategory', $('p-main').value);
  fd.append('extraCategories', JSON.stringify(wz.extra));
  fd.append('unlisted', $('p-unlisted').checked ? 'true' : 'false');
  fd.append('license', $('p-license').value);
  fd.append('links', JSON.stringify(wz.links.filter((l) => (l.url || '').trim()).map((l) => ({ type: l.type, url: l.url.trim() }))));
  fd.append('price', $('p-price').value);
  if (wz.logoFile) fd.append('icon', wz.logoFile);
  if (wz.modFile) fd.append('file', wz.modFile);
  wz.newShots.forEach((s) => fd.append('screenshots', s.file));
  const removed = wz.shots.filter((s) => s.removed).map((s) => s.id);
  if (removed.length) fd.append('removeScreenshots', JSON.stringify(removed));
  return fd;
}

// Sends the form with a progress bar (fetch cannot report upload progress).
function sendForm(method, url, formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $('wz-progress-bar').style.width = Math.round((e.loaded / e.total) * 100) + '%';
    };
    xhr.onload = () => {
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = new Error(data.message || 'Could not save the project.');
      err.status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => reject(new Error('Could not reach the server. Check your connection and try again.'));
    xhr.send(formData);
  });
}

async function saveProject() {
  if (wz.busy) return;
  for (let i = 0; i < STEPS.length; i++) {
    const err = validateStep(STEPS[i]);
    if (err) { goStep(i); setWzMsg(err); return; }
  }
  const editing = !!wz.id;
  wz.busy = true;
  ['wz-save', 'wz-submit', 'wz-next', 'wz-prev'].forEach((id) => { $(id).disabled = true; });
  $('wz-progress-bar').style.width = '0';
  $('wz-progress').classList.remove('hidden');
  setWzMsg('Saving…', true);
  try {
    await sendForm(editing ? 'PUT' : 'POST', editing ? '/api/admin/mods/' + encodeURIComponent(wz.id) : '/api/admin/mods', buildFormData());
    wz.newShots.forEach((s) => URL.revokeObjectURL(s.url));
    showProjects();
    setMsg('mod-msg', editing ? 'Project saved.' : 'Project created.', true);
    loadModsList();
  } catch (err) {
    if (err.status === 401 || err.status === 403) { handleApiError(err, 'mod-msg'); return; }
    setWzMsg(err.message);
  } finally {
    if (wz) {
      wz.busy = false;
      ['wz-save', 'wz-submit', 'wz-next'].forEach((id) => { $(id).disabled = false; });
      $('wz-prev').disabled = wz.step === 0;
      $('wz-progress').classList.add('hidden');
    }
  }
}

function leaveWizard() {
  if (wz && wz.busy) return;
  if (wz) wz.newShots.forEach((s) => URL.revokeObjectURL(s.url));
  showProjects();
}

// ---- markdown toolbar --------------------------------------------------------

function applyFormat(kind) {
  const ta = $('p-description');
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b);
  const wrap = (l, r, ph) => { const t = sel || ph; return { text: l + t + r, from: a + l.length, to: a + l.length + t.length }; };
  const prefixLines = (fn, ph) => {
    const lines = (sel || ph).split('\n').map(fn);
    const text = lines.join('\n');
    return { text, from: a, to: a + text.length };
  };
  let r;
  switch (kind) {
    case 'bold': r = wrap('**', '**', 'bold text'); break;
    case 'italic': r = wrap('*', '*', 'italic text'); break;
    case 'strike': r = wrap('~~', '~~', 'text'); break;
    case 'code': r = sel.includes('\n') ? wrap('```\n', '\n```', 'code') : wrap('`', '`', 'code'); break;
    case 'link': { const t = sel || 'link text'; r = { text: `[${t}](https://)`, from: a + t.length + 3, to: a + t.length + 11 }; break; }
    case 'h': r = prefixLines((l) => '## ' + l.replace(/^#+\s*/, ''), 'Heading'); break;
    case 'quote': r = prefixLines((l) => '> ' + l, 'Quote'); break;
    case 'ul': r = prefixLines((l) => '- ' + l, 'List item'); break;
    case 'ol': { let n = 0; r = prefixLines((l) => (++n) + '. ' + l, 'List item'); break; }
    case 'hr': r = { text: (a && value[a - 1] !== '\n' ? '\n' : '') + '\n---\n', from: 0, to: 0 }; r.from = r.to = a + r.text.length; break;
    default: return;
  }
  ta.focus();
  ta.setRangeText(r.text, a, b, 'end');
  ta.setSelectionRange(r.from, r.to);
  ta.dispatchEvent(new Event('input'));
}

// ---- wiring ---------------------------------------------------------------------

$('create-project-btn').addEventListener('click', () => { setMsg('mod-msg', ''); openWizard(null); });
$('wz-back').addEventListener('click', leaveWizard);
$('wz-cancel').addEventListener('click', leaveWizard);
$('wz-prev').addEventListener('click', () => goStep(Math.max(0, wz.step - 1)));
$('wz-next').addEventListener('click', tryNext);
$('wz-submit').addEventListener('click', saveProject);
$('wz-save').addEventListener('click', saveProject);
$('wz-banner-close').addEventListener('click', () => $('wz-banner').classList.add('hidden'));
document.querySelectorAll('#wz-steps button').forEach((b, i) => b.addEventListener('click', () => {
  if (wz) goStep(i);
}));

$('p-name').addEventListener('input', () => { updateCounters(); $('p-name').classList.remove('invalid'); });
$('p-summary').addEventListener('input', () => { updateCounters(); $('p-summary').classList.remove('invalid'); });
$('p-price').addEventListener('input', () => $('p-price').classList.remove('invalid'));
$('p-description').addEventListener('input', () => {
  updateCounters();
  $('p-description').classList.remove('invalid');
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 150);
});
$('p-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fmt]');
  if (b) applyFormat(b.dataset.fmt);
});

$('p-class').addEventListener('change', () => fillCategorySelects(null));
$('p-main').addEventListener('change', refreshExtraSelect);
$('p-extra-add').addEventListener('change', (e) => {
  if (e.target.value && wz.extra.length < catalog.limits.extraCategories) wz.extra.push(e.target.value);
  refreshExtraSelect();
});
$('p-add-link').addEventListener('click', () => {
  const used = new Set(wz.links.map((l) => l.type));
  wz.links.push({ type: catalog.linkTypes.find((t) => !used.has(t)) || catalog.linkTypes[0], url: '' });
  renderLinks();
});
$('p-license').addEventListener('change', renderLicenseLink);

$('p-logo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (wz.logoFile && wz.logoUrl && wz.logoUrl.startsWith('blob:')) URL.revokeObjectURL(wz.logoUrl);
  wz.logoFile = f;
  wz.logoUrl = URL.createObjectURL(f);
  renderLogo();
});
$('p-file').addEventListener('change', (e) => {
  wz.modFile = e.target.files[0] || null;
  renderFileCard();
});
$('p-shots').addEventListener('change', (e) => {
  Array.from(e.target.files).forEach((f) => wz.newShots.push({ file: f, url: URL.createObjectURL(f) }));
  e.target.value = '';
  renderGallery();
});

async function deleteMod(id) {
  const m = modsCache.find((x) => x.id === id);
  if (!confirm('Delete "' + (m ? m.name : 'this project') + '"? It will disappear from the shop. People who already bought it keep their download.')) return;
  try {
    await api('/api/admin/mods/' + encodeURIComponent(id), { method: 'DELETE' });
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
