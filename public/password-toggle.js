// Shows or hides a password field.
// Open eye  = password is hidden (click to show).
// Slashed eye = password is visible (click to hide).
(function () {
  function sync(btn, input) {
    var visible = input.type === 'text';
    btn.classList.toggle('is-visible', visible);
    btn.classList.toggle('is-hidden', !visible);
    btn.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
  }

  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    var field = btn.closest('.pw-field');
    var input = field && field.querySelector('input');
    if (!input) return;

    // Start with password hidden.
    if (input.type !== 'password') input.type = 'password';
    sync(btn, input);

    btn.addEventListener('click', function () {
      input.type = input.type === 'password' ? 'text' : 'password';
      sync(btn, input);
    });
  });
})();
