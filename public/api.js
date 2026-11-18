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
  var n = new URLSearchParams(location.search).get('next');
  return n && n.charAt(0) === '/' && n.charAt(1) !== '/' && n.indexOf('\\') < 0 ? n : null;
}
