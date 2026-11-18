'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// scrypt cost settings (OWASP's "N=2^15, r=8, p=3" profile). They are stored
// inside every hash, so they can be raised later without breaking old logins.
const SCRYPT = { N: 32768, r: 8, p: 3, keylen: 64, maxmem: 128 * 1024 * 1024 };

const SESSION_COOKIE = 'cd_session';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Used so a login for an unknown email takes as long as one for a real email.
let dummyHash;
async function burnPasswordCheck(password) {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummyHash);
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const nowSec = () => Math.floor(Date.now() / 1000);

function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000
  };
}

// Creates a session row and sets the cookie. Only the hash of the token is
// stored, so a leaked database cannot be used to hijack sessions.
function startSession(db, config, res, userId) {
  const token = newToken();
  const now = nowSec();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), userId, now + config.sessionDays * 86400, now);
  res.cookie(SESSION_COOKIE, token, cookieOptions(config));
}

function endSession(db, config, req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  const { maxAge, ...clearOpts } = cookieOptions(config);
  res.clearCookie(SESSION_COOKIE, clearOpts);
}

function endAllSessions(db, userId, exceptToken) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hashToken(exceptToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, role: row.role, hasPassword: Boolean(row.password_hash) };
}

// Looks up the logged-in user (if any) and puts it on req.user.
function attachUser(db) {
  const find = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  return (req, res, next) => {
    req.user = null;
    const token = req.cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token.length > 0 && token.length < 200) {
      req.user = find.get(hashToken(token), nowSec()) || null;
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_signed_in', message: 'Please sign in first.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not_signed_in', message: 'Please sign in first.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Admins only.' });
  next();
}

module.exports = {
  SESSION_COOKIE,
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  newToken,
  hashToken,
  nowSec,
  startSession,
  endSession,
  endAllSessions,
  publicUser,
  attachUser,
  requireAuth,
  requireAdmin
};
