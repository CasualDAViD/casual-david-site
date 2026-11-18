// Shows or hides a password field.
// Open eye  = password is hidden (click to show).
// Slashed eye = password is visible (click to hide).
(function () {
  function setVisible(el, visible) {
    if (!el) return;
    if (visible) {
      el.removeAttribute('hidden');
      el.style.display = '';
    } else {
      el.setAttribute('hidden', '');
      el.style.display = 'none';
    }
  }

  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    var field = btn.closest('.pw-field');
    var input = field && field.querySelector('input');
    if (!input) return;

    var open = btn.querySelector('.pw-eye-open');
    var off = btn.querySelector('.pw-eye-off');

    // Ensure initial state matches a hidden password field.
    setVisible(open, true);
    setVisible(off, false);

    btn.addEventListener('click', function () {
      var showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      btn.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
      // When password becomes visible, show the slashed eye.
      setVisible(open, !showing);
      setVisible(off, showing);
    });
  });
})();
