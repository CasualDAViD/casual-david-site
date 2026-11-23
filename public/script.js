// Public site: loads mods and social links from Firestore.

let modsCache = [];
let currentCurrency = 'USD';
let currentTypeFilter = 'all';
let ownedMods = new Set();

function waitForMods(maxWait = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (window.firebaseMods && typeof window.firebaseMods.list === 'function') {
        resolve(window.firebaseMods);
        return;
      }
      if (Date.now() - start > maxWait) {
        resolve(null);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function loadOwnedMods() {
  ownedMods = new Set();
  if (!window.firebaseAuth || !window.firebaseAuth.auth) return;
  const user = window.firebaseAuth.auth.currentUser;
  if (!user) return;
  try {
    const { getFirestore, collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
    const db = getFirestore();
    const q = query(collection(db, 'purchases'), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (data.modId) ownedMods.add(data.modId);
    });
  } catch (e) { console.warn('Could not load purchases', e); }
}

function getCategoryLabel(mod) {
  let type = (mod.type || 'mod');
  type = type === 'bedrock' ? 'Bedrock Addon' : type.charAt(0).toUpperCase() + type.slice(1);
  const subs = Array.isArray(mod.subcategories) && mod.subcategories.length
    ? mod.subcategories.join(', ')
    : (mod.subcategory || mod.mainCategory || '');
  return subs ? `${type} • ${subs}` : type;
}

function formatDownloads(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function renderModsGrid() {
  const grid = document.getElementById('mods-grid');
  if (!grid) return;

  const filtered = currentTypeFilter === 'all'
    ? modsCache
    : modsCache.filter(m => (m.type || 'mod') === currentTypeFilter);

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:4rem 1rem; color:#64748b;">
        <p style="font-size:1.1rem;">No ${currentTypeFilter === 'all' ? 'mods' : currentTypeFilter + 's'} listed yet.</p>
        <p style="margin-top:0.5rem; font-size:0.9rem;">Check back soon or follow the socials.</p>
      </div>`;
    return;
  }

  grid.innerHTML = `
    <div class="filter-bar">
      <label>Type:
        <select id="type-select" class="filter-select">
          <option value="all" ${currentTypeFilter==='all'?'selected':''}>All</option>
          <option value="mod" ${currentTypeFilter==='mod'?'selected':''}>Mod</option>
          <option value="plugin" ${currentTypeFilter==='plugin'?'selected':''}>Plugin</option>
          <option value="bedrock" ${currentTypeFilter==='bedrock'?'selected':''}>Bedrock Addon</option>
        </select>
      </label>
      <label>Currency:
        <select id="currency-select" class="filter-select">
          <option value="USD" ${currentCurrency==='USD'?'selected':''}>USD</option>
          <option value="NGN" ${currentCurrency==='NGN'?'selected':''}>NGN</option>
          <option value="EUR" ${currentCurrency==='EUR'?'selected':''}>EUR</option>
        </select>
      </label>
    </div>
  ` + filtered.map(mod => {
    const versions = mod.versions || [];
    const minPrice = versions.length ? Math.min(...versions.map(v => Number(v.price) || 0)) : (mod.price || 0);
    const seal = fileSealOf(mod);
    const fileUrl = fileUrlOf(mod);
    const hasFile = !!(seal || fileUrl);
    const owned = ownedMods.has(mod.id);
    const fileName = fileNameOf(mod);
    const downloads = formatDownloads(mod.downloads || 0);
    return `
    <div class="mod-card" data-id="${escapeHtml(mod.id)}" style="cursor:pointer;">
      <div class="mod-header">
        <div class="mod-icon">
          ${safeUrl(mod.icon) ? `<img src="${escapeHtml(safeUrl(mod.icon))}" alt="">` : '<span>📦</span>'}
        </div>
        <div class="mod-title">
          <strong>${escapeHtml(mod.name)}</strong>
          <span class="mod-cat">${escapeHtml(getCategoryLabel(mod))}</span>
        </div>
      </div>
      <p class="mod-desc">${escapeHtml(mod.summary || mod.description || '')}</p>
      <div style="display:flex; align-items:center; gap:0.4rem; font-size:0.85rem; color:#64748b; margin: 0.4rem 0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>${downloads}</span>
      </div>
      <div class="mod-footer">
        <div class="mod-price">${owned ? 'Owned' : formatPrice(minPrice, currentCurrency) + (versions.length > 1 ? '+' : '')}</div>
        ${hasFile
          ? (owned
              ? (seal
                  ? `<button class="buy-btn" data-seal="${escapeHtml(mod.id)}" data-name="${escapeHtml(fileName)}">Download</button>`
                  : `<a class="buy-btn" href="${escapeHtml(fileUrl)}" download="${escapeHtml(fileName)}" data-dl="${escapeHtml(mod.id)}" style="text-decoration:none;">Download</a>`)
              : `<button class="buy-btn" data-buy="${escapeHtml(mod.id)}">Buy</button>`)
          : '<button class="buy-btn" disabled style="opacity:0.6;cursor:not-allowed;">Coming soon</button>'}
      </div>
    </div>`;
  }).join('');

  document.getElementById('currency-select').addEventListener('change', (e) => changeCurrency(e.target.value));
  document.getElementById('type-select').addEventListener('change', (e) => {
    currentTypeFilter = e.target.value;
    renderModsGrid();
  });
  grid.querySelectorAll('.mod-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.buy-btn')) return;
      location.href = 'product.html?id=' + encodeURIComponent(card.dataset.id);
    });
  });
  grid.querySelectorAll('[data-buy]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      location.href = 'checkout.html?id=' + encodeURIComponent(btn.dataset.buy);
    });
  });
  grid.querySelectorAll('[data-seal]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.disabled = true;
      try { await downloadOwnedFile(btn.dataset.seal, btn.dataset.name); }
      catch (err) { btn.textContent = 'Try again'; btn.disabled = false; }
    });
  });
  grid.querySelectorAll('[data-dl]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const modId = btn.dataset.dl;
      try {
        const { getFirestore, doc, updateDoc, increment } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js');
        const db = getFirestore();
        await updateDoc(doc(db, 'mods', modId), { downloads: increment(1) });
      } catch (err) { console.warn('Could not count download', err); }
    });
  });
}

async function renderMods() {
  const grid = document.getElementById('mods-grid');
  if (!grid) return;
  grid.innerHTML = '<p style="grid-column:1/-1; text-align:center; padding:3rem 1rem; color:#64748b;">Loading…</p>';
  try {
    const modsApi = await waitForMods();
    if (!modsApi) throw new Error('Mods loader failed to start. Refresh the page.');
    modsCache = await modsApi.list();
    await loadOwnedMods();
  } catch (err) {
    grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; padding:3rem 1rem; color:#dc2626;">${escapeHtml(err.message)}</p>`;
    return;
  }
  currentCurrency = getCurrency();
  renderModsGrid();
}

function changeCurrency(cur) {
  currentCurrency = cur;
  setCurrency(cur);
  renderModsGrid();
}

function renderSocials(s) {
  const container = document.getElementById('socials-cards');
  if (!container) return;

  const platforms = [
    {
      key: 'youtube',
      name: 'YouTube',
      handle: s.youtubeHandle || '@Casual_DAViD',
      label: 'MAIN CHANNEL',
      title: 'Server reviews, mod tests, and relaxed survival.',
      desc: 'Long-form videos covering unique servers, mods actually worth your time, and chill survival gameplay you can leave on in the background.',
      url: safeUrl(s.youtube) || '#',
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="#ff0000"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8zM9.8 15.5v-7l6.3 3.5-6.3 3.5z"/></svg>`
    },
    {
      key: 'tiktok',
      name: 'TikTok',
      handle: s.tiktokHandle || '@casual_david',
      label: 'QUICK CLIPS',
      title: 'Fast mod finds and building ideas.',
      desc: 'Quick mod spotlights, shader tests, and bite-sized clips for when you’re just scrolling.',
      url: safeUrl(s.tiktok) || '#',
      icon: `<svg width="22" height="22" viewBox="0 0 24 24"><path fill="#000" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>`
    },
    {
      key: 'discord',
      name: 'Discord',
      handle: 'Join the server',
      label: 'COMMUNITY',
      title: 'Chat, support, and updates.',
      desc: 'Join the community, get support, and chat about mods and Minecraft.',
      url: safeUrl(s.discord) || '#',
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`
    },
    {
      key: 'modrinth',
      name: 'Modrinth',
      handle: 'Download mods',
      label: 'MODRINTH',
      title: 'Free mods and plugins.',
      desc: 'Grab free mods and plugins directly from Modrinth.',
      url: safeUrl(s.modrinth) || '#',
      icon: `<img src="modrinth.png" width="22" height="22" style="object-fit:contain; background:transparent;">`
    },
    {
      key: 'curseforge',
      name: 'CurseForge',
      handle: 'More downloads',
      label: 'CURSEFORGE',
      title: 'Mods on CurseForge.',
      desc: 'Find more of my mods and plugins on CurseForge.',
      url: safeUrl(s.curseforge) || '#',
      icon: `<img src="curseforge.png" width="22" height="22" style="object-fit:contain; background:transparent;">`
    }
  ];

  container.innerHTML = platforms.map(p => `
    <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener" class="social-card-ref">
      <div class="sc-top">
        <div class="sc-icon-wrap">${p.icon}</div>
        <div>
          <strong>${p.name}</strong>
          <div class="sc-handle">${escapeHtml(p.handle)}</div>
        </div>
        <span class="sc-arrow">↗</span>
      </div>
      <div class="sc-label">${p.label}</div>
      <h3>${p.title}</h3>
      <p>${p.desc}</p>
      <div class="sc-link">${p.key === 'discord' ? 'Join Discord' : 'Watch on ' + p.name} →</div>
    </a>
  `).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  renderMods();
  if (document.getElementById('socials-cards')) {
    let socials = {};
    try {
      const modsApi = await waitForMods();
      if (modsApi && modsApi.getSocials) {
        socials = await modsApi.getSocials();
      }
    } catch (e) {}
    renderSocials(socials);
  }
});
