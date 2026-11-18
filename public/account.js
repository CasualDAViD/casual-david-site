// Header account button and dropdown. The signed-in state comes from the server.

function openLogin() {
  location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search);
}

async function updateAccountBtn() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;
  const user = await getMe();
  if (user) {
    btn.textContent = user.name.split(' ')[0];
    btn.onclick = toggleDropdown;
  } else {
    btn.textContent = 'Sign in';
    btn.onclick = openLogin;
  }
}

async function toggleDropdown(e) {
  e.stopPropagation();
  let dd = document.getElementById('account-dropdown');
  if (dd) { dd.remove(); return; }

  const user = await getMe();
  dd = document.createElement('div');
  dd.id = 'account-dropdown';
  dd.style.cssText = 'position:fixed; background:white; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 24px rgb(0 0 0 / 0.12); min-width:180px; z-index:9999; overflow:hidden;';
  if (document.documentElement.getAttribute('data-theme') === 'dark') {
    dd.style.background = '#1e293b';
    dd.style.borderColor = '#334155';
  }
  const item = 'display:block; padding:0.75rem 1rem; text-decoration:none; color:inherit; font-size:0.9rem;';
  dd.innerHTML = `
    <a href="history.html" style="${item}">Purchase history</a>
    ${user && user.role === 'admin' ? `<a href="admin.html" style="${item} border-top:1px solid #e2e8f0;">Admin</a>` : ''}
    <a href="#" id="logout-link" style="${item} border-top:1px solid #e2e8f0;">Log out</a>
  `;
  document.body.appendChild(dd);
  dd.querySelector('#logout-link').addEventListener('click', (ev) => { ev.preventDefault(); logout(); });
  const rect = document.getElementById('account-btn').getBoundingClientRect();
  dd.style.top = (rect.bottom + 8) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';

  setTimeout(() => {
    document.addEventListener('click', () => dd.remove(), { once: true });
  }, 0);
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* still leave the page */ }
  location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', updateAccountBtn);
