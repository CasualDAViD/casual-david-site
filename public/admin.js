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

const STEPS = ['general', 'description', 'pricing', 'license', 'files'];
const LAST_FORM_STEP = 3; // License; the Files tab has its own buttons
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
  $('file-view').classList.add('hidden');
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

async function openWizard(id, startStep, flash) {
  try { await loadCatalog(); } catch (err) { handleApiError(err, 'mod-msg'); return; }
  const m = id ? modsCache.find((x) => x.id === id) : null;
  if (id && !m) return;
  const firstClass = Object.keys(catalog.classes)[0];

  wz = {
    id: m ? m.id : null,
    step: 0,
    logoFile: null,
    logoUrl: m ? m.icon : null,
    files: [],
    flash: '',
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
  $('p-shots').value = '';
  fillSelect($('p-class'), Object.keys(catalog.classes), cls);
  fillCategorySelects(m ? m.mainCategory : null);
  fillSelect($('p-license'), catalog.licenses.map((l) => l.name), m && m.license ? m.license.name : 'All Rights Reserved');
  document.querySelectorAll('#wizard .invalid').forEach((el) => el.classList.remove('invalid'));
  $('wz-msg').textContent = '';
  $('wz-progress').classList.add('hidden');
  $('wz-banner').classList.toggle('hidden', !!m);
  ['wz-save', 'wz-submit', 'wz-next', 'wz-prev'].forEach((bid) => { $(bid).disabled = false; });

  wz.flash = flash || '';
  $('wz-tab-files').classList.toggle('hidden', !m);
  $('file-view').classList.add('hidden');
  renderLogo(); renderChips(); renderLinks(); renderGallery(); renderLicenseLink();
  updateCounters(); updatePreview();
  $('projects-view').classList.add('hidden');
  $('wizard').classList.remove('hidden');
  goStep(startStep || 0);
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
  const onFiles = STEPS[i] === 'files';
  const last = i >= LAST_FORM_STEP;
  $('wz-bar').classList.toggle('hidden', onFiles);
  $('wz-banner').classList.toggle('hidden', editing || onFiles);
  $('wz-prev').disabled = i === 0;
  $('wz-next').classList.toggle('hidden', last);
  $('wz-submit').classList.toggle('hidden', !last || editing);
  $('wz-save').classList.toggle('hidden', !editing);
  $('wz-submit').textContent = 'Create';
  setWzMsg('');
  if (onFiles) loadFiles();
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
  if (name === 'pricing') {
    const p = parseFloat($('p-price').value);
    if (!flag($('p-price'), !(p > 0))) return 'Enter a price above $0.';
  }
  return '';
}

function tryNext() {
  const err = validateStep(STEPS[wz.step]);
  if (err) { setWzMsg(err); return; }
  goStep(Math.min(wz.step + 1, LAST_FORM_STEP));
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
  wz.newShots.forEach((s) => fd.append('screenshots', s.file));
  const removed = wz.shots.filter((s) => s.removed).map((s) => s.id);
  if (removed.length) fd.append('removeScreenshots', JSON.stringify(removed));
  return fd;
}

// Sends the form with a progress bar (fetch cannot report upload progress).
function sendForm(method, url, formData, barId) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) $(barId || 'wz-progress-bar').style.width = Math.round((e.loaded / e.total) * 100) + '%';
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
    const saved = await sendForm(editing ? 'PUT' : 'POST', editing ? '/api/admin/mods/' + encodeURIComponent(wz.id) : '/api/admin/mods', buildFormData());
    wz.newShots.forEach((s) => URL.revokeObjectURL(s.url));
    if (!editing) {
      // Straight on to the Files tab: a project needs a file before anyone can buy it.
      wz.busy = false;
      await loadModsList();
      await openWizard(saved.mod.id, STEPS.indexOf('files'), 'Project created. Now add your first file so people can buy it.');
      return;
    }
    showProjects();
    setMsg('mod-msg', 'Project saved.', true);
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

function applyFormat(kind, ta) {
  ta = ta || $('p-description');
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
  if (b) applyFormat(b.dataset.fmt, $('p-description'));
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
$('p-shots').addEventListener('change', (e) => {
  Array.from(e.target.files).forEach((f) => wz.newShots.push({ file: f, url: URL.createObjectURL(f) }));
  e.target.value = '';
  renderGallery();
});

// ---- files tab ----------------------------------------------------------------

const RELEASE_LABEL = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };

function timeAgo(sec) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  const units = [[86400 * 30, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, name] of units) {
    if (diff >= size) { const n = Math.floor(diff / size); return n + ' ' + name + (n === 1 ? '' : 's') + ' ago'; }
  }
  return 'just now';
}

async function loadFiles() {
  const flash = $('files-flash');
  flash.style.display = wz.flash ? '' : 'none';
  $('files-flash-text').textContent = wz.flash || '';
  wz.flash = '';
  try {
    wz.files = (await api('/api/admin/mods/' + encodeURIComponent(wz.id) + '/files')).files;
  } catch (err) {
    $('files-flash-text').textContent = err.message || 'Could not load files.';
    flash.style.display = '';
    wz.files = [];
  }
  renderFiles();
}

function renderFiles() {
  const term = $('files-search').value.trim().toLowerCase();
  const type = $('files-type').value;
  const rows = wz.files.filter((f) =>
    (!type || f.releaseType === type) &&
    (!term || (f.displayName + ' ' + f.fileName + ' ' + f.gameVersions.join(' ')).toLowerCase().includes(term)));
  $('files-empty').style.display = rows.length ? 'none' : '';
  $('files-empty').textContent = wz.files.length ? 'No files match your search.' : 'No files yet. Add your first file to make this project buyable.';
  $('files-body').innerHTML = rows.map((f) => {
    const chips = f.gameVersions.slice(0, 3).map((v) => `<span class="vchip">${escapeHtml(v)}</span>`).join('') +
      (f.gameVersions.length > 3 ? `<span class="vchip">+${f.gameVersions.length - 3}</span>` : '');
    const dep = f.dependencies.length ? f.dependencies.map((d) => escapeHtml(d.name)).join(', ') : '&mdash;';
    const list = (a) => (a.length ? a.map(escapeHtml).join(', ') : '&mdash;');
    return `
      <tr class="file-row" data-id="${f.id}">
        <td><span class="caret">&#9656;</span></td>
        <td>${escapeHtml(f.displayName)}</td>
        <td><span class="rel-badge ${f.releaseType}" title="${RELEASE_LABEL[f.releaseType]}">${RELEASE_LABEL[f.releaseType][0]}</span></td>
        <td><span class="status-dot ${f.status}">${f.status === 'published' ? 'Published' : 'Draft'}</span></td>
        <td>${timeAgo(f.createdAt)}</td>
        <td>${chips}</td>
        <td>${f.downloads}</td>
      </tr>
      <tr class="file-detail hidden" data-detail="${f.id}"><td colspan="7">
        <div class="fd-grid">
          <div><b>File</b>${escapeHtml(f.fileName)} (${formatSize(f.size) || '0 KB'})</div>
          <div><b>Environment</b>${list(f.environments)}</div>
          <div><b>Modloader</b>${list(f.modloaders)}</div>
          <div><b>Java</b>${list(f.javaVersions)}</div>
          <div><b>Minecraft</b>${list(f.gameVersions)}</div>
          <div><b>Related projects</b>${dep}</div>
        </div>
        <div class="md">${f.changelog ? renderMarkdown(f.changelog) : '<p class="muted">No changelog.</p>'}</div>
        <div class="fd-actions">
          <button class="btn" data-fedit="${f.id}">Edit</button>
          <button class="btn" data-ftoggle="${f.id}">${f.status === 'published' ? 'Move to drafts' : 'Publish'}</button>
          <a class="btn" href="/api/downloads/${encodeURIComponent(wz.id)}/${f.id}">Download</a>
          <button class="btn btn-danger" data-fdelete="${f.id}">Delete</button>
        </div>
      </td></tr>`;
  }).join('');
}

$('files-body').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-fedit]');
  const toggle = e.target.closest('[data-ftoggle]');
  const del = e.target.closest('[data-fdelete]');
  if (edit) return openFileForm(Number(edit.dataset.fedit));
  if (toggle) {
    const f = wz.files.find((x) => x.id === Number(toggle.dataset.ftoggle));
    const fd = new FormData();
    fd.append('status', f.status === 'published' ? 'draft' : 'published');
    try {
      await sendForm('PUT', '/api/admin/mods/' + encodeURIComponent(wz.id) + '/files/' + f.id, fd, 'ff-progress-bar');
    } catch (err) { wz.flash = err.message; }
    return loadFiles();
  }
  if (del) {
    const f = wz.files.find((x) => x.id === Number(del.dataset.fdelete));
    if (!confirm('Delete "' + f.displayName + '"? People who bought this project will no longer be able to download this file.')) return;
    try {
      await api('/api/admin/mods/' + encodeURIComponent(wz.id) + '/files/' + f.id, { method: 'DELETE' });
    } catch (err) { wz.flash = err.message; }
    return loadFiles();
  }
  const row = e.target.closest('tr.file-row');
  if (row) {
    const detail = document.querySelector('[data-detail="' + row.dataset.id + '"]');
    detail.classList.toggle('hidden');
    row.classList.toggle('open', !detail.classList.contains('hidden'));
  }
});
$('files-search').addEventListener('input', renderFiles);
$('files-type').addEventListener('change', renderFiles);
$('add-file-btn').addEventListener('click', () => openFileForm(null));

// ---- upload / edit a file ---------------------------------------------------------

let fz = null;
let fzPreviewTimer = null;
const FZ_LISTS = {
  env: { box: 'ff-env', opt: 'environments', prompt: 'Select environment' },
  loader: { box: 'ff-loader', opt: 'modloaders', prompt: 'Select modloader' },
  java: { box: 'ff-java', opt: 'javaVersions', prompt: 'Select Java' },
  mc: { box: 'ff-mc', opt: 'gameVersions', prompt: 'Select Minecraft versions' }
};

function renderMulti(key) {
  const def = FZ_LISTS[key];
  const options = catalog.files[def.opt];
  const chosen = fz.sel[key];
  const rest = options.filter((o) => !chosen.includes(o));
  $(def.box).innerHTML =
    `<div class="wz-chips">${chosen.map((c, i) => `<span class="wz-chip">${escapeHtml(c)}<button type="button" data-rm="${i}" aria-label="Remove ${escapeHtml(c)}">&times;</button></span>`).join('')}</div>` +
    `<select aria-label="${escapeHtml(def.prompt)}"><option value="">${escapeHtml(def.prompt)}</option>${rest.map((o) => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
  $(def.box).querySelector('select').addEventListener('change', (e) => { if (e.target.value) { chosen.push(e.target.value); renderMulti(key); } });
  $(def.box).querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { chosen.splice(Number(b.dataset.rm), 1); renderMulti(key); }));
}

function renderDeps() {
  const others = modsCache.filter((m) => m.id !== wz.id && !fz.deps.includes(m.id));
  $('ff-deps').innerHTML = fz.deps.map((id, i) => {
    const m = modsCache.find((x) => x.id === id);
    return `<span class="wz-chip">${escapeHtml(m ? m.name : 'Removed project')}<button type="button" data-rm="${i}" aria-label="Remove">&times;</button></span>`;
  }).join('');
  $('ff-deps').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { fz.deps.splice(Number(b.dataset.rm), 1); renderDeps(); }));
  const sel = $('ff-dep-add');
  sel.innerHTML = '<option value="">Add related project&hellip;</option>' + others.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  sel.disabled = others.length === 0 || fz.deps.length >= catalog.files.limits.dependencies;
}

function updateFilePreview() {
  const src = $('ff-changelog').value;
  $('ff-preview').innerHTML = src.trim() ? renderMarkdown(src) : '<p class="placeholder">Nothing to preview yet.</p>';
}

// Reads what it can from a name like "flashback-inventories-1.5.1mc26.3-fabric.jar".
function detectFromName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const versions = catalog.files.gameVersions;
  const found = { mc: [], loader: [] };
  const tagged = base.match(/mc[-_]?(\d+(?:\.\d+)+)/i);
  if (tagged && versions.includes(tagged[1])) found.mc.push(tagged[1]);
  else {
    const hits = (base.match(/\d+(?:\.\d+)+/g) || []).filter((t) => versions.includes(t));
    if (hits.length) found.mc.push(hits[hits.length - 1]);
  }
  for (const loader of catalog.files.modloaders) {
    if (new RegExp('(^|[^a-z])' + loader.toLowerCase() + '([^a-z]|$)', 'i').test(base)) found.loader.push(loader);
  }
  return found;
}

function openFileForm(fileId) {
  const f = fileId ? wz.files.find((x) => x.id === fileId) : null;
  const mod = modsCache.find((m) => m.id === wz.id);
  fz = {
    id: f ? f.id : null, modFile: null, autoName: '',
    needsLoader: !!mod && mod.class === 'Mods',
    sel: {
      env: f ? [...f.environments] : [], loader: f ? [...f.modloaders] : [],
      java: f ? [...f.javaVersions] : [], mc: f ? [...f.gameVersions] : []
    },
    deps: f ? f.dependencies.map((d) => d.id) : []
  };
  $('ff-title').textContent = f ? 'Edit File' : 'Upload New File';
  $('ff-crumbs').textContent = (mod ? mod.name : 'Project') + '  ›  ' + (f ? 'Edit file' : 'Upload file');
  $('ff-file').value = '';
  $('ff-file-name').textContent = f ? f.fileName + (f.size ? ' (' + formatSize(f.size) + ')' : '') : 'No file chosen';
  $('ff-file-sub').textContent = f ? 'The uploaded file cannot be replaced. Upload a new file instead.' : '.jar, .zip, .mrpack, .mcpack, .mcaddon, .7z or .rar';
  $('ff-file-btn').classList.toggle('disabled', !!f);
  $('ff-name').value = f ? f.displayName : '';
  $('ff-type').value = f ? f.releaseType : 'release';
  $('ff-changelog').value = f ? f.changelog : '';
  document.querySelector('input[name="ff-publish"][value="auto"]').checked = true;
  ['ff-publish-field', 'ff-publish-divider'].forEach((id) => $(id).classList.toggle('hidden', !!f));
  $('ff-env-req').style.display = $('ff-loader-req').style.display = fz.needsLoader ? '' : 'none';
  $('ff-copied').style.display = 'none';
  $('ff-submit').textContent = f ? 'Save changes' : 'Add File';
  $('ff-submit').disabled = false;
  $('ff-msg').textContent = '';
  $('ff-progress').classList.add('hidden');
  document.querySelectorAll('#file-view .invalid').forEach((el) => el.classList.remove('invalid'));
  Object.keys(FZ_LISTS).forEach(renderMulti);
  renderDeps(); updateFilePreview();
  $('wizard').classList.add('hidden');
  $('file-view').classList.remove('hidden');
  window.scrollTo(0, 0);
}

function closeFileForm() {
  if (fz && fz.busy) return;
  fz = null;
  $('file-view').classList.add('hidden');
  $('wizard').classList.remove('hidden');
  goStep(STEPS.indexOf('files'));
}

function setFileMsg(text, ok) {
  const el = $('ff-msg');
  el.textContent = text || '';
  el.className = 'wz-msg ' + (ok ? 'success' : 'error');
}

$('ff-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !fz) return;
  fz.modFile = file;
  $('ff-file-name').textContent = file.name + ' (' + formatSize(file.size) + ')';
  const base = file.name.replace(/\.[^.]+$/, '');
  if (!$('ff-name').value.trim() || $('ff-name').value === fz.autoName) { $('ff-name').value = base; fz.autoName = base; }
  const found = detectFromName(file.name);
  const copied = [];
  if (found.mc.length && fz.sel.mc.length === 0) { fz.sel.mc = found.mc; copied.push('Minecraft'); }
  if (found.loader.length && fz.sel.loader.length === 0) { fz.sel.loader = found.loader; copied.push('Modloader'); }
  Object.keys(FZ_LISTS).forEach(renderMulti);
  $('ff-copied').style.display = copied.length ? '' : 'none';
  $('ff-copied-text').textContent = 'These values were copied from the file "' + file.name + '" (' + copied.join(', ') + '). Check them before adding.';
});
$('ff-copied-close').addEventListener('click', () => { $('ff-copied').style.display = 'none'; });
$('ff-changelog').addEventListener('input', () => { clearTimeout(fzPreviewTimer); fzPreviewTimer = setTimeout(updateFilePreview, 150); });
$('ff-toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fmt]');
  if (b) applyFormat(b.dataset.fmt, $('ff-changelog'));
});
$('ff-dep-add').addEventListener('change', (e) => {
  if (e.target.value) { fz.deps.push(e.target.value); renderDeps(); }
});
$('ff-back').addEventListener('click', closeFileForm);
$('ff-cancel').addEventListener('click', closeFileForm);

$('ff-submit').addEventListener('click', async () => {
  if (!fz || fz.busy) return;
  const editing = !!fz.id;
  const problem =
    (!editing && !fz.modFile && 'Choose a file to upload.') ||
    (fz.needsLoader && fz.sel.env.length === 0 && 'Choose at least one environment.') ||
    (fz.needsLoader && fz.sel.loader.length === 0 && 'Choose at least one modloader.') ||
    (fz.sel.mc.length === 0 && 'Choose at least one Minecraft version.') || '';
  if (problem) { setFileMsg(problem); return; }

  const fd = new FormData();
  if (!editing) fd.append('file', fz.modFile);
  fd.append('displayName', $('ff-name').value.trim());
  fd.append('releaseType', $('ff-type').value);
  if (!editing) fd.append('publish', document.querySelector('input[name="ff-publish"]:checked').value);
  fd.append('environments', JSON.stringify(fz.sel.env));
  fd.append('modloaders', JSON.stringify(fz.sel.loader));
  fd.append('javaVersions', JSON.stringify(fz.sel.java));
  fd.append('gameVersions', JSON.stringify(fz.sel.mc));
  fd.append('changelog', $('ff-changelog').value.trim());
  fd.append('dependencies', JSON.stringify(fz.deps));

  fz.busy = true;
  $('ff-submit').disabled = true;
  $('ff-progress-bar').style.width = '0';
  $('ff-progress').classList.remove('hidden');
  setFileMsg(editing ? 'Saving…' : 'Uploading…', true);
  try {
    const base = '/api/admin/mods/' + encodeURIComponent(wz.id) + '/files';
    await sendForm(editing ? 'PUT' : 'POST', editing ? base + '/' + fz.id : base, fd, 'ff-progress-bar');
    fz.busy = false;
    wz.flash = editing ? 'File saved.' : 'File added.';
    loadModsList(); // refreshes the "No file" badge and availability
    closeFileForm();
  } catch (err) {
    if (err.status === 401 || err.status === 403) { handleApiError(err, 'mod-msg'); return; }
    setFileMsg(err.message);
    fz.busy = false;
    $('ff-submit').disabled = false;
    $('ff-progress').classList.add('hidden');
  }
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
