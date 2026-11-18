// Shows or hides a password field. The open eye means it is hidden.
(function () {
  document.querySelectorAll('.pw-toggle').forEach(function (btn) {
    var field = btn.closest('.pw-field');
    var input = field && field.querySelector('input');
    if (!input) return;
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      var open = btn.querySelector('.pw-eye-open');
      var off = btn.querySelector('.pw-eye-off');
      if (open) open.hidden = show;
      if (off) off.hidden = !show;
    });
  });
})();
