// Simple admin: Firebase Auth + Firestore (Storage optional)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

function showTab(tab) {
  ['mods', 'socials'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

async function loadMods() {
  const list = $('admin-mod-list');
  list.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const snap = await getDocs(collection(db, 'mods'));
    if (snap.empty) {
      list.innerHTML = '<p class="muted">No mods yet.</p>';
      return;
    }
    list.innerHTML = snap.docs.map((d) => {
      const m = d.data();
      const versions = m.versions || [];
      const price = versions.length ? versions[0].price : (m.price || 0);
      return `<div class="mod-item">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          ${m.icon ? `<img src="${m.icon}" class="preview-img">` : '<div class="preview-img"></div>'}
          <div>
            <strong>${m.name || ''}</strong>
            <div class="muted">$${Number(price).toFixed(2)} • ${m.mainCategory || m.category || ''}</div>
          </div>
        </div>
        <div>
          <button class="btn" style="padding:0.4rem 0.7rem;margin-right:0.4rem;" data-edit="${d.id}">Edit</button>
          <button class="btn btn-danger" style="padding:0.4rem 0.7rem;" data-delete="${d.id}">Delete</button>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editMod(b.dataset.edit)));
    list.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deleteMod(b.dataset.delete)));
  } catch (err) {
    list.innerHTML = '<p class="error">Could not load mods. Check Firestore rules.</p>';
  }
}

async function uploadFile(file, path) {
  try {
    const r = ref(storage, path);
    await uploadBytes(r, file);
    return await getDownloadURL(r);
  } catch (e) {
    console.warn('Upload skipped:', e.message);
    return null;
  }
}

$('save-mod-btn').addEventListener('click', async () => {
  const name = $('mod-name').value.trim();
  const summary = $('mod-summary').value.trim();
  const description = $('mod-desc').value.trim();
  const price = parseFloat($('mod-price').value);
  const category = $('mod-category').value;
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
      price,
      mainCategory: category,
      category,
      updatedAt: Date.now(),
      unlisted: false,
      versions: [{ name: '1.0', price, displayName: '', fileUrl: '', fileName: '' }]
    };

    if ($('mod-icon').files[0]) {
      const url = await uploadFile($('mod-icon').files[0], `mods/${editId}/icon`);
      if (url) data.icon = url;
    }
    if ($('mod-file').files[0]) {
      const url = await uploadFile($('mod-file').files[0], `mods/${editId}/file`);
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
    $('mod-price').value = '';
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
  const versions = m.versions || [];
  const price = versions.length ? versions[0].price : (m.price || 0);
  $('edit-id').value = id;
  $('mod-name').value = m.name || '';
  $('mod-summary').value = m.summary || '';
  $('mod-desc').value = m.description || '';
  $('mod-price').value = price;
  $('mod-category').value = m.mainCategory || m.category || 'Utility & QoL';
  $('form-title').textContent = 'Edit Mod';
  $('cancel-edit-btn').classList.remove('hidden');
  window.scrollTo(0, 0);
}

$('cancel-edit-btn').addEventListener('click', () => {
  $('edit-id').value = '';
  $('form-title').textContent = 'Add Mod';
  $('cancel-edit-btn').classList.add('hidden');
  $('mod-name').value = '';
  $('mod-summary').value = '';
  $('mod-desc').value = '';
  $('mod-price').value = '';
});

async function deleteMod(id) {
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
