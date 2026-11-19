// CurseForge-style admin wizard on Firebase (Auth + Firestore + Storage)

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
let wz = null; // current wizard state

function showView(id) {
  ['loading-view', 'login-view', 'dashboard'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
}

function isAdmin(user) {
  return user && ADMIN_EMAILS.includes((user.email || '').toLowerCase());
}

// ---- auth ----------------------------------------------------------------
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

// ---- tabs ----------------------------------------------------------------
function showTab(tab) {
  ['mods', 'socials'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- projects list -------------------------------------------------------
async function loadProjects() {
  const list = $('admin-mod-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const snap = await getDocs(collection(db, 'mods'));
  if (snap.empty) {
    list.innerHTML = '<div class="empty-state"><p>No projects yet.</p></div>';
    return;
  }
  list.innerHTML = snap.docs.map((d) => {
    const m = d.data();
    return `<div class="mod-item">
      <div class="mod-meta">
        ${m.icon ? `<img src="${m.icon}" class="preview-img">` : '<div class="preview-img"></div>'}
        <div>
          <strong>${m.name || ''}</strong>
          ${m.unlisted ? '<span class="pill unlisted">Unlisted</span>' : ''}
          ${m.fileUrl ? '' : '<span class="pill nofile">No file</span>'}
          <div class="muted">$${Number(m.price || 0).toFixed(2)} • ${m.mainCategory || ''}</div>
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
}

$('create-project-btn').addEventListener('click', () => openWizard());

// ---- wizard --------------------------------------------------------------
function showStep(step) {
  document.querySelectorAll('.wz-steps button').forEach((b) => b.classList.toggle('active', b.dataset.step === step));
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== step));
  const idx = STEPS.indexOf(step);
  $('wz-prev').disabled = idx === 0;
  $('wz-next').textContent = idx === STEPS.length - 1 ? 'Save project' : 'Next';
  wz.step = step;
}

async function openWizard(id) {
  $('projects-view').classList.add('hidden');
  $('wizard').classList.remove('hidden');
  $('wz-title').textContent = id ? 'Edit Project' : 'Create Project';

  wz = { id: id || crypto.randomUUID(), step: 'general', logoFile: null, file: null, screens: [] };

  if (id) {
    const snap = await getDoc(doc(db, 'mods', id));
    if (snap.exists()) {
      const m = snap.data();
      $('p-name').value = m.name || '';
      $('p-summary').value = m.summary || '';
      $('p-description').value = m.description || '';
      $('p-price').value = m.price || '';
      $('p-class').value = m.class || 'Mods';
      $('p-maincat').value = m.mainCategory || 'Utility & QoL';
      $('p-unlisted').checked = !!m.unlisted;
      $('p-license').value = m.license || 'All Rights Reserved';
      if (m.icon) $('p-logo-box').innerHTML = `<img src="${m.icon}">`;
      updateSummaryCount();
      updatePreview();
    }
  } else {
    ['p-name', 'p-summary', 'p-description', 'p-price'].forEach((id) => $(id).value = '');
    $('p-logo-box').textContent = '📦';
    $('p-file-name').textContent = 'No file selected';
  }
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

$('p-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  wz.file = f || null;
  $('p-file-name').textContent = f ? f.name : 'No file selected';
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
  // Save
  const name = $('p-name').value.trim();
  const summary = $('p-summary').value.trim();
  const description = $('p-description').value.trim();
  const price = parseFloat($('p-price').value) || 0;
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
      name, summary, description, price,
      class: $('p-class').value,
      mainCategory: $('p-maincat').value,
      unlisted: $('p-unlisted').checked,
      license: $('p-license').value,
      updatedAt: Date.now()
    };

    if (wz.logoFile) data.icon = await upload(wz.logoFile, `mods/${wz.id}/icon`);
    if (wz.file) {
      data.fileUrl = await upload(wz.file, `mods/${wz.id}/file`);
      data.fileName = wz.file.name;
    }
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

// ---- socials -------------------------------------------------------------
const SOCIAL = {
  youtube: 'yt-url', tiktok: 'tt-url', discord: 'dc-url', modrinth: 'mr-url',
  curseforge: 'cf-url', personalDiscord: 'pd-url', email: 'em-url', donate: 'dn-url'
};

async function loadSocials() {
  const snap = await getDoc(doc(db, 'config', 'socials'));
  if (!snap.exists()) return;
  const s = snap.data();
  for (const [k, id] of Object.entries(SOCIAL)) if ($(id)) $(id).value = s[k] || '';
}

$('save-socials-btn').addEventListener('click', async () => {
  const data = {};
  for (const [k, id] of Object.entries(SOCIAL)) data[k] = $(id).value.trim();
  await setDoc(doc(db, 'config', 'socials'), data);
  $('social-msg').textContent = 'Social links saved!';
});
