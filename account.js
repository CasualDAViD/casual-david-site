function openLogin() {
  location.href = 'login.html';
}

function updateAccountBtn() {
  const btn = document.getElementById('account-btn');
  if (!btn) return;
  const user = localStorage.getItem('cd_user');
  if (user) {
    const name = user.split('@')[0];
    btn.textContent = name;
    btn.onclick = toggleDropdown;
  } else {
    btn.textContent = 'Sign in';
    btn.onclick = openLogin;
  }
}

function toggleDropdown(e) {
  e.stopPropagation();
  let dd = document.getElementById('account-dropdown');
  if (dd) { dd.remove(); return; }

  dd = document.createElement('div');
  dd.id = 'account-dropdown';
  dd.style.cssText = 'position:fixed; background:white; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 24px rgb(0 0 0 / 0.12); min-width:180px; z-index:9999; overflow:hidden;';
  if (document.documentElement.getAttribute('data-theme') === 'dark') {
    dd.style.background = '#1e293b';
    dd.style.borderColor = '#334155';
  }
  dd.innerHTML = `
    <a href="history.html" style="display:block; padding:0.75rem 1rem; text-decoration:none; color:inherit; font-size:0.9rem;">Purchase history</a>
    <a href="#" onclick="logout(); return false;" style="display:block; padding:0.75rem 1rem; text-decoration:none; color:inherit; font-size:0.9rem; border-top:1px solid #e2e8f0;">Log out</a>
  `;
  document.body.appendChild(dd);
  const rect = document.getElementById('account-btn').getBoundingClientRect();
  dd.style.top = (rect.bottom + 8) + 'px';
  dd.style.right = (window.innerWidth - rect.right) + 'px';

  setTimeout(() => {
    document.addEventListener('click', () => dd.remove(), { once: true });
  }, 0);
}

function logout() {
  localStorage.removeItem('cd_user');
  location.reload();
}

document.addEventListener('DOMContentLoaded', updateAccountBtn);
