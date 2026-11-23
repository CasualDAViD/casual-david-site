// Shared helpers loaded on every page: talking to the server, escaping text,
// and showing prices.

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Calls the API. Resolves with the parsed JSON, or throws an Error whose
// message is safe to show to the visitor (with .status and .code attached).
async function api(path, options) {
  const opts = options || {};
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.json);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    const err = new Error('Could not reach the server. Check your connection and try again.');
    err.code = 'network';
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.message) || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.code = (data && data.error) || 'error';
    throw err;
  }
  return data;
}

var CD_RATES = { USD: 1, NGN: 1550, EUR: 0.92 };

var _cdConfig = null;
// Site settings from the server (exchange rates, which features are switched on).
function getConfig() {
  if (!_cdConfig) {
    _cdConfig = api('/api/config').then(function (c) {
      if (c && c.rates) CD_RATES = c.rates;
      return c;
    }).catch(function () {
      return { rates: CD_RATES, payments: false, passwordReset: false, oauth: { google: false, discord: false } };
    });
  }
  return _cdConfig;
}

var _cdMe = null;
// The signed-in user, or null.
function getMe(force) {
  if (force || !_cdMe) {
    _cdMe = api('/api/auth/me').then(function (d) { return d.user; }).catch(function () { return null; });
  }
  return _cdMe;
}

// Currency choice is only a display preference, so the browser may remember it.
function getCurrency() {
  try {
    var c = localStorage.getItem('cd_currency');
    return ['USD', 'NGN', 'EUR'].indexOf(c) >= 0 ? c : 'USD';
  } catch (e) { return 'USD'; }
}
function setCurrency(c) {
  try { localStorage.setItem('cd_currency', c); } catch (e) { /* private mode */ }
}

function formatPrice(usd, currency, rates) {
  var r = rates || CD_RATES;
  var amount = usd * r[currency];
  if (currency === 'NGN') return '₦' + Math.round(amount).toLocaleString();
  if (currency === 'EUR') return '€' + amount.toFixed(2);
  return '$' + amount.toFixed(2);
}

function formatKobo(kobo) {
  return '₦' + (kobo / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// A same-site path to return to after signing in (?next=/checkout.html?id=...).
function nextParam() {
  return safeNext(new URLSearchParams(location.search).get('next'));
}

// Same-site relative path only. Blocks open redirects and javascript: URLs.
function safeNext(value) {
  if (typeof value !== 'string') return null;
  if (!value || value.charAt(0) !== '/' || value.charAt(1) === '/' || value.indexOf('\\') >= 0) return null;
  if (/[\u0000-\u001f]/.test(value) || value.length > 300) return null;
  return value;
}

// http(s) only. Use this before putting a saved link into href or src.
function safeUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    var u = new URL(value, location.origin);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch (e) { /* ignore */ }
  return '';
}

var CD_PAYSTACK_URL = 'https://casualdavid-paystack.okpeidavid7.workers.dev/';
var CD_UPLOAD_URL = 'https://casualdavid-upload.okpeidavid7.workers.dev/';

function fileSealOf(mod) {
  if (!mod) return '';
  var versions = mod.versions || [];
  return mod.fileSeal || (versions[0] && versions[0].fileSeal) || '';
}
function fileUrlOf(mod) {
  if (!mod) return '';
  var versions = mod.versions || [];
  return safeUrl(mod.fileUrl || (versions[0] && versions[0].fileUrl) || '');
}
function fileNameOf(mod) {
  if (!mod) return 'download';
  var versions = mod.versions || [];
  return mod.fileName || (versions[0] && versions[0].fileName) || 'download';
}

function renderPlainMarkdown(md) {
  var html = escapeHtml(md || '');
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
  html = html.replace(/https?:\/\/[^\s<]+/g, function (url) {
    var safe = safeUrl(url);
    return safe ? '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener">' + escapeHtml(url) + '</a>' : escapeHtml(url);
  });
  return html;
}

async function downloadOwnedFile(modId, fileName) {
  var user = window.firebaseAuth && window.firebaseAuth.auth && window.firebaseAuth.auth.currentUser;
  if (!user) {
    location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search);
    return;
  }
  var token = await user.getIdToken();
  var res = await fetch(CD_UPLOAD_URL + 'download', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modId: modId })
  });
  if (!res.ok) throw new Error('Download is not available yet. If you just paid, wait a moment and try again from purchase history.');
  var blob = await res.blob();
  var a = document.createElement('a');
  var url = URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}
