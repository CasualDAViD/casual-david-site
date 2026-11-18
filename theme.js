// Shared theme handling with SVG icons
(function() {
  const themes = ['system', 'light', 'dark'];
  let idx = themes.indexOf(localStorage.getItem('cd_theme') || 'system');
  if (idx < 0) idx = 0;

  const icons = {
    system: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h6v2H8v2h8v-2h-2v-2h6c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/><path d="M8.5 8.5l1.4 1.4-1.4 1.4L7.1 9.9zM15.5 8.5l1.4 1.4-1.4 1.4-1.4-1.4zM12 10.2l1.2 1.2-1.2 1.2-1.2-1.2z"/></svg>`,
    light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="#f59e0b"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#f59e0b" stroke-width="2" fill="none"/></svg>`,
    dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/><path d="M17 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 9l.5 1 1 .5-1 .5-.5 1-.5-1-1-.5 1-.5z"/></svg>`
  };

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply() {
    const choice = themes[idx];
    localStorage.setItem('cd_theme', choice);
    const root = document.documentElement;
    let effective = choice === 'system' ? getSystemTheme() : choice;
    root.setAttribute('data-theme', effective);

    const btn = document.getElementById('theme-btn');
    if (btn) btn.innerHTML = icons[choice];
  }

  window.cycleTheme = function() {
    idx = (idx + 1) % 3;
    apply();
  };

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themes[idx] === 'system') apply();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();

function toggleMenu() {
  document.getElementById('mobile-menu').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}
