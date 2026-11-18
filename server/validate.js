'use strict';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function bodyOf(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function cleanName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 80 ? name : null;
}

// 8+ characters; capped so a huge password cannot be used to waste CPU.
function passwordProblem(value) {
  if (typeof value !== 'string') return 'Password is required.';
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (value.length > 200) return 'Password is too long.';
  return null;
}

// Returns a trimmed http(s) URL or null. Rejects javascript:, data:, etc.,
// because these values end up in href attributes on public pages.
function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s.length === 0 || s.length > 300) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// Only same-site relative paths are allowed as a post-login destination.
function safeNext(value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  if (/[\r\n]/.test(value) || value.length > 300) return null;
  return value;
}

// Dollars (number or string) -> integer cents, or null if unusable.
function priceToCents(value) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 100000) return null;
  const cents = Math.round(n * 100);
  return cents > 0 ? cents : null;
}

// Keeps a download name safe for a Content-Disposition header.
function safeFileName(original, fallbackBase, ext) {
  const base = String(original || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/^[._ -]+|[._ -]+$/g, '')
    .slice(0, 80);
  const fallback = String(fallbackBase || 'download')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80) || 'download';
  return (base || fallback) + ext;
}

module.exports = {
  bodyOf,
  cleanEmail,
  cleanName,
  passwordProblem,
  cleanUrl,
  safeNext,
  priceToCents,
  safeFileName
};
