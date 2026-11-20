// Smooth page transitions
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('http') || a.target === '_blank') return;
  e.preventDefault();
  document.body.classList.add('page-exit');
  setTimeout(() => { location.href = a.href; }, 160);
});
