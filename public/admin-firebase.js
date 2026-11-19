// Admin dashboard using Firebase Auth + Firestore + Storage

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

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

const $ = (id) => document.getElementById(id);

function showView(id) {
  ['loading-view', 'login-view', 'dashboard'].forEach((v) => $(v).classList.toggle('hidden', v !== id));
}

function setMsg(id, text, ok) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = ok ? 'success' : 'error';
}

function isAdmin(user) {
  return user && ADMIN_EMAILS.includes((user.email || '').toLowerCase());
}

// ---- auth ----------------------------------------------------------------
onAuthStateChanged(auth, (user) => {
  if (isAdmin(user)) {
    showView('dashboard');
    loadMods();
    loadSocials();
  } else {
    if (user) setMsg('login-msg', 'This account is not an admin.');
    showView('login-view');
  }
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

$('logout-btn').addEventListener('click', () => signOut(auth));

// ---- tabs ----------------------------------------------------------------
function showTab(tab) {
  ['mods', 'socials'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ---- mods ----------------------------------------------------------------
async function loadMods() {
  const list = $('admin-mod-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  const snap = await getDocs(collection(db, 'mods'));
  if (snap.empty) {
    list.innerHTML = '<p class="muted">No mods yet.</p>';
    return;
  }
  list.innerHTML = snap.docs.map((d) => {
    const m = d.data();
    return `<div class="mod-item">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${m.icon ? `<img src="${m.icon}" class="preview-img">` : '<div class="preview-img"></div>'}
        <div><strong>${m.name || ''}</strong><div class="muted">$${Number(m.price || 0).toFixed(2)}</div></div>
      </div>
      <div>
        <button class="btn" style="padding:0.4rem 0.7rem;margin-right:0.4rem;" data-edit="${d.id}">Edit</button>
        <button class="btn btn-danger" style="padding:0.4rem 0.7rem;" data-delete="${d.id}">Delete</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editMod(b.dataset.edit)));
  list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteMod(b.dataset.delete)));
}

async function uploadFile(file, path) {
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

$('save-mod-btn').addEventListener('click', async () => {
  const name = $('mod-name').value.trim();
  const description = $('mod-desc').value.trim();
  const price = parseFloat($('mod-price').value);
  const category = $('mod-category').value;
  const editId = $('edit-id').value || crypto.randomUUID();

  if (!name || !description || !price) {
    setMsg('mod-msg', 'Name, description, and price are required.');
    return;
  }

  const btn = $('save-mod-btn');
  btn.disabled = true;
  setMsg('mod-msg', 'Saving…', true);

  try {
    const data = { name, description, price, category, updatedAt: Date.now() };

    if ($('mod-icon').files[0]) {
      data.icon = await uploadFile($('mod-icon').files[0], `mods/${editId}/icon`);
    }
    if ($('mod-screens').files.length) {
      data.screenshots = [];
      for (let i = 0; i < $('mod-screens').files.length; i++) {
        const url = await uploadFile($('mod-screens').files[i], `mods/${editId}/shot-${i}`);
        data.screenshots.push(url);
      }
    }
    if ($('mod-file').files[0]) {
      data.fileUrl = await uploadFile($('mod-file').files[0], `mods/${editId}/file`);
      data.fileName = $('mod-file').files[0].name;
    }

    await setDoc(doc(db, 'mods', editId), data, { merge: true });
    setMsg('mod-msg', 'Mod saved!', true);
    $('edit-id').value = '';
    $('form-title').textContent = 'Add Mod';
    loadMods();
  } catch (err) {
    setMsg('mod-msg', err.message);
  } finally {
    btn.disabled = false;
  }
});

async function editMod(id) {
  const snap = await getDoc(doc(db, 'mods', id));
  if (!snap.exists()) return;
  const m = snap.data();
  $('edit-id').value = id;
  $('mod-name').value = m.name || '';
  $('mod-desc').value = m.description || '';
  $('mod-price').value = m.price || '';
  $('mod-category').value = m.category || 'Mod';
  $('form-title').textContent = 'Edit Mod';
  $('cancel-edit-btn').classList.remove('hidden');
  window.scrollTo(0, 0);
}

$('cancel-edit-btn').addEventListener('click', () => {
  $('edit-id').value = '';
  $('form-title').textContent = 'Add Mod';
  $('cancel-edit-btn').classList.add('hidden');
  $('mod-name').value = '';
  $('mod-desc').value = '';
  $('mod-price').value = '';
});

async function deleteMod(id) {
  if (!confirm('Delete this mod?')) return;
  await deleteDoc(doc(db, 'mods', id));
  loadMods();
}

// ---- socials -------------------------------------------------------------
const SOCIAL_FIELDS = {
  youtube: 'yt-url', youtubeHandle: 'yt-handle', tiktok: 'tt-url', tiktokHandle: 'tt-handle',
  discord: 'dc-url', modrinth: 'mr-url', curseforge: 'cf-url', personalDiscord: 'pd-url',
  email: 'em-url', donate: 'dn-url'
};

async function loadSocials() {
  const snap = await getDoc(doc(db, 'config', 'socials'));
  if (!snap.exists()) return;
  const s = snap.data();
  for (const [key, id] of Object.entries(SOCIAL_FIELDS)) {
    if ($(id)) $(id).value = s[key] || '';
  }
}

$('save-socials-btn').addEventListener('click', async () => {
  const data = {};
  for (const [key, id] of Object.entries(SOCIAL_FIELDS)) data[key] = $(id).value.trim();
  await setDoc(doc(db, 'config', 'socials'), data);
  setMsg('social-msg', 'Social links saved!', true);
});
