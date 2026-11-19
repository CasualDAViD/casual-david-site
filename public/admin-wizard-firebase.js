// CurseForge-style admin wizard on Firebase (Auth + Firestore + Storage)
// Supports multiple versions with individual prices + 10% all-versions discount

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, getDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBHuDf1Yrbktjv15mFJtTdLd3YA2XCmDUs",
  authDomain: "casualdavid-site.firebaseapp.com",
  projectId: "casualdavid-site",
  storageBucket: "casualdavid-site.firebasestorage.app",
  messagingSenderId: "884094241084",
  appId: "1:884094241084:web:2ab1c7940ac014450cf639"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

const ADMIN_EMAILS = ['okpeidavid7@gmail.com'];
const STEPS = ['general', 'description', 'pricing', 'license'];

const $ = (id) => document.getElementById(id);
let wz = null;

function showView(id) {
  ['loading-view', 'login-view', 'dashboard'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
}

function isAdmin(user) {
  return user && ADMIN_EMAILS.includes((user.email || '').toLowerCase());
}

onAuthStateChanged(auth, (user) => {
  if (isAdmin(user)) {
    showView('dashboard');
    loadProjects();
    loadSocials();
  } else {
    if (user) $('login-msg').textContent = 'This account is not an admin.';
    showView('login-view');
  }
});

$('google-btn').addEventListener('click', () => signInWithPopup(auth, googleProvider).catch(e => $('login-msg').textContent = e.message));
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-btn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('login-email').value, $('login-password').value);
  } catch (err) {
    $('login-msg').textContent = err.message;
    $('login-btn').disabled = false;
  }
});
$('logout-btn').addEventListener('click', () => signOut(auth));

function showTab(tab) {
  ['mods', 'socials'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

async function loadProjects() {
  const list = $('admin-mod-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const snap = await getDocs(collection(db, 'mods'));
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state"><p>No projects yet.</p></div>';
      return;
    }
    list.innerHTML = snap.docs.map((d) => {
      const m = d.data();
      const versions = m.versions || [];
      const hasFiles = versions.some(v => v.fileUrl);
      const minPrice = versions.length ? Math.min(...versions.map(v => Number(v.price) || 0)) : (m.price || 0);
      return `<div class="mod-item">
        <div class="mod-meta">
          ${m.icon ? `<img src="${m.icon}" class="preview-img">` : '<div class="preview-img"></div>'}
          <div>
            <strong>${m.name || ''}</strong>
            ${m.unlisted ? '<span class="pill unlisted">Unlisted</span>' : ''}
            ${hasFiles ? '' : '<span class="pill nofile">No file</span>'}
            <div class="muted">${versions.length} version(s) • from $${Number(minPrice).toFixed(2)} • ${m.mainCategory || ''}</div>
            <div class="muted">${m.summary || ''}</div>
          </div>
        </div>
        <div class="mod-actions">
          <button class="btn" data-edit="${d.id}">Edit</button>
          <button class="btn btn-danger" data-delete="${d.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openWizard(b.dataset.edit)));
    list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteProject(b.dataset.delete)));
  } catch (err) {
    list.innerHTML = '<p class="error">Could not load projects. Check Firestore is enabled.</p>';
    console.error(err);
  }
}

$('create-project-btn').addEventListener('click', () => openWizard());

function showStep(step) {
  document.querySelectorAll('.wz-steps button').forEach((b) => b.classList.toggle('active', b.dataset.step === step));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== step));
  const idx = STEPS.indexOf(step);
  $('wz-prev').disabled = idx === 0;
  $('wz-next').textContent = idx === STEPS.length - 1 ? 'Save project' : 'Next';
  wz.step = step;
}

function renderVersions() {
  const list = $('versions-list');
  list.innerHTML = wz.versions.map((v, i) => `
    <div class="version-row" data-i="${i}">
      <input type="text" placeholder="Version (e.g. 1.21.11)" value="${v.name || ''}" data-field="name">
      <input type="number" placeholder="Price" step="0.01" min="0" value="${v.price || ''}" data-field="price">
      <input type="text" placeholder="Display name / changelog" value="${v.displayName || ''}" data-field="displayName">
      <button type="button" class="btn btn-danger" style="padding:0.4rem 0.6rem; margin:0;" data-remove="${i}">✕</button>
    </div>
  `).join('');
  list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    wz.versions.splice(Number(b.dataset.remove), 1);
    renderVersions();
  }));
  list.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const i = Number(e.target.closest('.version-row').dataset.i);
      const field = e.target.dataset.field;
      if (field === 'price') wz.versions[i].price = parseFloat(e.target.value) || 0;
      else wz.versions[i][field] = e.target.value;
    });
  });
}

function addVersionRow(v = { name: '', price: 0, displayName: '', file: null, fileUrl: '', fileName: '' }) {
  if (!wz.versions) wz.versions = [];
  wz.versions.push(v);
  renderVersions();
}

$('add-version-btn').addEventListener('click', () => addVersionRow());

async function openWizard(id) {
  $('projects-view').classList.add('hidden');
  $('wizard').classList.remove('hidden');
  $('wz-title').textContent = id ? 'Edit Project' : 'Create Project';

  wz = { id: id || crypto.randomUUID(), step: 'general', logoFile: null, screens: [], versions: [] };

  if (id) {
    const snap = await getDoc(doc(db, 'mods', id));
    if (snap.exists()) {
      const m = snap.data();
      $('p-name').value = m.name || '';
      $('p-summary').value = m.summary || '';
      $('p-description').value = m.description || '';
      $('p-class').value = m.class || 'Mods';
      $('p-maincat').value = m.mainCategory || 'Utility & QoL';
      $('p-unlisted').checked = !!m.unlisted;
      $('p-license').value = m.license || 'All Rights Reserved';
      if (m.icon) $('p-logo-box').innerHTML = `<img src="${m.icon}">`;
      wz.versions = (m.versions || []).map(v => ({ ...v, file: null }));
      if (!wz.versions.length && m.fileUrl) {
        wz.versions.push({ name: '1.0', price: m.price || 0, displayName: m.fileName || '', fileUrl: m.fileUrl, fileName: m.fileName || '' });
      }
      updateSummaryCount();
      updatePreview();
    }
  } else {
    ['p-name', 'p-summary', 'p-description'].forEach((id) => $(id).value = '');
    $('p-logo-box').textContent = '📦';
  }
  if (!wz.versions.length) addVersionRow();
  else renderVersions();
  showStep('general');
}

function updateSummaryCount() {
  $('p-summary-count').textContent = ($('p-summary').value.length) + '/256';
}
$('p-summary').addEventListener('input', updateSummaryCount);

function updatePreview() {
  const md = $('p-description').value;
  $('p-preview').innerHTML = md
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\n/g, '<br>') || '<span class="placeholder">Preview</span>';
}
$('p-description').addEventListener('input', updatePreview);

document.querySelectorAll('.wz-toolbar button').forEach((b) => {
  b.addEventListener('click', () => {
    const ta = $('p-description');
    const start = ta.selectionStart, end = ta.selectionEnd;
    const sel = ta.value.slice(start, end);
    const pre = b.dataset.md || '', post = b.dataset.md2 || '';
    ta.value = ta.value.slice(0, start) + pre + sel + post + ta.value.slice(end);
    updatePreview();
    ta.focus();
  });
});

$('p-logo').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  wz.logoFile = f;
  const url = URL.createObjectURL(f);
  $('p-logo-box').innerHTML = `<img src="${url}">`;
});

$('p-screens').addEventListener('change', (e) => {
  wz.screens = Array.from(e.target.files);
  const gal = $('p-gallery');
  gal.innerHTML = '';
  wz.screens.forEach((f) => {
    const url = URL.createObjectURL(f);
    gal.innerHTML += `<div class="wz-thumb new"><img src="${url}"></div>`;
  });
});

document.querySelectorAll('.wz-steps button').forEach((b) => b.addEventListener('click', () => showStep(b.dataset.step)));

$('wz-prev').addEventListener('click', () => {
  const i = STEPS.indexOf(wz.step);
  if (i > 0) showStep(STEPS[i - 1]);
});

$('wz-cancel').addEventListener('click', () => {
  $('wizard').classList.add('hidden');
  $('projects-view').classList.remove('hidden');
  wz = null;
});

$('wz-back').addEventListener('click', () => $('wz-cancel').click());

async function upload(file, path) {
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

$('wz-next').addEventListener('click', async () => {
  const i = STEPS.indexOf(wz.step);
  if (i < STEPS.length - 1) {
    showStep(STEPS[i + 1]);
    return;
  }

  const name = $('p-name').value.trim();
  const summary = $('p-summary').value.trim();
  const description = $('p-description').value.trim();
  if (!name || !summary) {
    $('wz-msg').textContent = 'Name and summary are required.';
    $('wz-msg').className = 'wz-msg error';
    showStep('general');
    return;
  }

  $('wz-next').disabled = true;
  $('wz-msg').textContent = 'Saving…';
  $('wz-msg').className = 'wz-msg';

  try {
    const data = {
      name, summary, description,
      class: $('p-class').value,
      mainCategory: $('p-maincat').value,
      unlisted: $('p-unlisted').checked,
      license: $('p-license').value,
      updatedAt: Date.now(),
      allVersionsDiscount: 10
    };

    if (wz.logoFile) data.icon = await upload(wz.logoFile, `mods/${wz.id}/icon`);

    const versions = [];
    for (let i = 0; i < wz.versions.length; i++) {
      const v = wz.versions[i];
      const entry = {
        name: v.name || ('v' + (i + 1)),
        price: Number(v.price) || 0,
        displayName: v.displayName || '',
        fileUrl: v.fileUrl || '',
        fileName: v.fileName || ''
      };
      // Note: file upload per version would need a file input per row.
      // For now we store the metadata; full file upload UI can be extended.
      versions.push(entry);
    }
    data.versions = versions;

    if (wz.screens.length) {
      data.screenshots = [];
      for (let i = 0; i < wz.screens.length; i++) {
        data.screenshots.push(await upload(wz.screens[i], `mods/${wz.id}/shot-${Date.now()}-${i}`));
      }
    }

    await setDoc(doc(db, 'mods', wz.id), data, { merge: true });
    $('wz-msg').textContent = 'Saved!';
    $('wz-msg').className = 'wz-msg success';
    setTimeout(() => {
      $('wizard').classList.add('hidden');
      $('projects-view').classList.remove('hidden');
      loadProjects();
    }, 600);
  } catch (err) {
    $('wz-msg').textContent = err.message;
    $('wz-msg').className = 'wz-msg error';
  } finally {
    $('wz-next').disabled = false;
  }
});

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  await deleteDoc(doc(db, 'mods', id));
  loadProjects();
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
  $('social-msg').textContent = 'Social links saved!';
});
