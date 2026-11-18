const TEMP_EMAIL = 'okpeidavid7@gmail.com';
const TEMP_PASSWORD = '12345678';
let loginAttempts = 0;
const MAX_ATTEMPTS = 5;

function getAdminData() {
  try {
    return JSON.parse(localStorage.getItem('cd_admin') || '{}');
  } catch {
    return {};
  }
}

function setAdminData(data) {
  localStorage.setItem('cd_admin', JSON.stringify(data));
}

function isLoggedIn() {
  return sessionStorage.getItem('cd_logged_in') === '1';
}

function needsPasswordChange() {
  const data = getAdminData();
  return !data.passwordChanged;
}

function showView(id) {
  ['login-view', 'change-pw-view', 'dashboard'].forEach(v => {
    document.getElementById(v).classList.add('hidden');
  });
  document.getElementById(id).classList.remove('hidden');
}

function login() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  const msg = document.getElementById('login-msg');

  if (loginAttempts >= MAX_ATTEMPTS) {
    msg.textContent = 'Too many attempts. Please wait and try again later.';
    return;
  }

  const data = getAdminData();
  const storedPass = data.password || TEMP_PASSWORD;

  if (email !== TEMP_EMAIL || pass !== storedPass) {
    loginAttempts++;
    msg.textContent = 'Invalid email or password.';
    return;
  }

  loginAttempts = 0;
  sessionStorage.setItem('cd_logged_in', '1');
  msg.textContent = '';

  if (!data.passwordChanged) {
    showView('change-pw-view');
  } else {
    showDashboard();
  }
}

function changePassword() {
  const np = document.getElementById('new-password').value;
  const cp = document.getElementById('confirm-password').value;
  const msg = document.getElementById('pw-msg');

  if (np.length < 6) {
    msg.textContent = 'Password must be at least 6 characters.';
    return;
  }
  if (np !== cp) {
    msg.textContent = 'Passwords do not match.';
    return;
  }

  const data = getAdminData();
  data.password = np;
  data.passwordChanged = true;
  setAdminData(data);

  msg.textContent = '';
  showDashboard();
}

function logout() {
  sessionStorage.removeItem('cd_logged_in');
  showView('login-view');
}

function showDashboard() {
  showView('dashboard');
  showTab('mods');
  loadModsList();
  loadSocialsForm();
}

function showTab(tab) {
  document.getElementById('tab-mods').classList.toggle('hidden', tab !== 'mods');
  document.getElementById('tab-socials').classList.toggle('hidden', tab !== 'socials');
  document.querySelectorAll('.tabs button').forEach((b, i) => {
    b.classList.toggle('active', (tab === 'mods' && i === 0) || (tab === 'socials' && i === 1));
  });
}

function getMods() {
  try { return JSON.parse(localStorage.getItem('cd_mods') || '[]'); } catch { return []; }
}
function setMods(mods) {
  localStorage.setItem('cd_mods', JSON.stringify(mods));
}

function getSocials() {
  try { return JSON.parse(localStorage.getItem('cd_socials') || '{}'); } catch { return {}; }
}
function setSocials(s) {
  localStorage.setItem('cd_socials', JSON.stringify(s));
}

function loadModsList() {
  const list = document.getElementById('admin-mod-list');
  const mods = getMods();
  if (mods.length === 0) {
    list.innerHTML = '<p style="color:#64748b;">No mods yet. Add one above.</p>';
    return;
  }
  list.innerHTML = mods.map(m => `
    <div class="mod-item">
      <div style="display:flex; align-items:center; gap:0.75rem;">
        ${m.icon ? `<img src="${m.icon}" class="preview-img">` : '<div class="preview-img"></div>'}
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          <div style="font-size:0.85rem; color:#64748b;">₦${Number(m.price).toLocaleString()}</div>
        </div>
      </div>
      <div>
        <button class="btn" style="padding:0.4rem 0.7rem; margin-right:0.4rem;" onclick="editMod('${m.id}')">Edit</button>
        <button class="btn btn-danger" style="padding:0.4rem 0.7rem;" onclick="deleteMod('${m.id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[m]));
}

let iconData = null;
let screenshotsData = [];

document.getElementById('mod-icon')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    iconData = reader.result;
    document.getElementById('icon-preview').innerHTML = `<img src="${iconData}" class="preview-img" style="margin-top:0.5rem;">`;
  };
  reader.readAsDataURL(file);
});

document.getElementById('mod-screens')?.addEventListener('change', e => {
  screenshotsData = [];
  const files = Array.from(e.target.files);
  const preview = document.getElementById('screens-preview') || (() => {
    const d = document.createElement('div');
    d.id = 'screens-preview';
    e.target.parentNode.insertBefore(d, e.target.nextSibling);
    return d;
  })();
  preview.innerHTML = '';
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      screenshotsData.push(reader.result);
      preview.innerHTML += `<img src="${reader.result}" class="preview-img" style="margin:0.25rem;">`;
    };
    reader.readAsDataURL(file);
  });
});

function saveMod() {
  const name = document.getElementById('mod-name').value.trim();
  const desc = document.getElementById('mod-desc').value.trim();
  const price = Number(document.getElementById('mod-price').value);
  const category = document.getElementById('mod-category').value;
  const editId = document.getElementById('edit-id').value;
  const msg = document.getElementById('mod-msg');

  if (!name || !desc || !price) {
    msg.textContent = 'Name, description, and price are required.';
    msg.className = 'error';
    return;
  }

  const mods = getMods();
  const id = editId || 'mod-' + Date.now();

  const mod = {
    id,
    name,
    description: desc,
    price,
    category,
    icon: iconData || (mods.find(m => m.id === id)?.icon || null),
    screenshots: screenshotsData.length ? screenshotsData : (mods.find(m => m.id === id)?.screenshots || [])
  };

  if (editId) {
    const idx = mods.findIndex(m => m.id === editId);
    if (idx >= 0) mods[idx] = mod;
  } else {
    mods.push(mod);
  }

  setMods(mods);
  msg.textContent = 'Mod saved!';
  msg.className = 'success';

  // reset form
  document.getElementById('mod-name').value = '';
  document.getElementById('mod-desc').value = '';
  document.getElementById('mod-price').value = '';
  document.getElementById('edit-id').value = '';
  document.getElementById('mod-icon').value = '';
  document.getElementById('icon-preview').innerHTML = '';
  iconData = null;

  loadModsList();
}

function editMod(id) {
  const mods = getMods();
  const m = mods.find(x => x.id === id);
  if (!m) return;
  document.getElementById('edit-id').value = m.id;
  document.getElementById('mod-name').value = m.name;
  document.getElementById('mod-desc').value = m.description;
  document.getElementById('mod-price').value = m.price;
  document.getElementById('mod-category').value = m.category || 'Mod';
  iconData = m.icon || null;
  document.getElementById('icon-preview').innerHTML = m.icon ? `<img src="${m.icon}" class="preview-img" style="margin-top:0.5rem;">` : '';
  showTab('mods');
  window.scrollTo(0, 0);
}

function deleteMod(id) {
  if (!confirm('Delete this mod?')) return;
  const mods = getMods().filter(m => m.id !== id);
  setMods(mods);
  loadModsList();
}

function loadSocialsForm() {
  const s = getSocials();
  document.getElementById('yt-url').value = s.youtube || '';
  document.getElementById('yt-handle').value = s.youtubeHandle || '';
  document.getElementById('tt-url').value = s.tiktok || '';
  document.getElementById('tt-handle').value = s.tiktokHandle || '';
  document.getElementById('dc-url').value = s.discord || '';
  document.getElementById('mr-url').value = s.modrinth || '';
  document.getElementById('cf-url').value = s.curseforge || '';
  document.getElementById('pd-url').value = s.personalDiscord || '';
  document.getElementById('em-url').value = s.email || '';
  document.getElementById('dn-url').value = s.donate || '';
}

function saveSocials() {
  const s = {
    youtube: document.getElementById('yt-url').value.trim(),
    youtubeHandle: document.getElementById('yt-handle').value.trim(),
    tiktok: document.getElementById('tt-url').value.trim(),
    tiktokHandle: document.getElementById('tt-handle').value.trim(),
    discord: document.getElementById('dc-url').value.trim(),
    modrinth: document.getElementById('mr-url').value.trim(),
    curseforge: document.getElementById('cf-url').value.trim()
  };
  setSocials(s);
  document.getElementById('social-msg').textContent = 'Social links saved!';
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  if (isLoggedIn()) {
    if (needsPasswordChange()) {
      showView('change-pw-view');
    } else {
      showDashboard();
    }
  } else {
    showView('login-view');
  }
});
