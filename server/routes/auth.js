'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const { bodyOf, cleanEmail, cleanName, passwordProblem } = require('../validate');
const { resetEmail } = require('../mailer');

function limiter(config, options = {}) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' },
    ...options
  });
}

module.exports = function authRoutes({ db, config, mailer }) {
  const router = express.Router();
  const strict = limiter(config);
  const loginLimiter = limiter(config, { skipSuccessfulRequests: true });

  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const findById = db.prepare('SELECT * FROM users WHERE id = ?');

  router.post('/signup', strict, async (req, res) => {
    const body = bodyOf(req);
    const email = cleanEmail(body.email);
    const name = cleanName(body.name);
    const problem = passwordProblem(body.password);
    if (!email) return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
    if (!name) return res.status(400).json({ error: 'invalid_name', message: 'Enter your name.' });
    if (problem) return res.status(400).json({ error: 'invalid_password', message: problem });
    if (findByEmail.get(email)) {
      return res.status(409).json({ error: 'email_taken', message: 'An account with that email already exists. Try signing in.' });
    }

    const hash = await auth.hashPassword(body.password);
    let userId;
    try {
      userId = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, hash).lastInsertRowid;
    } catch (err) {
      // Two signups for the same email at the same moment.
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: 'email_taken', message: 'An account with that email already exists. Try signing in.' });
      }
      throw err;
    }
    auth.startSession(db, config, res, userId);
    res.status(201).json({ user: auth.publicUser(findById.get(userId)) });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const body = bodyOf(req);
    const email = cleanEmail(body.email);
    const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    const user = email ? findByEmail.get(email) : null;

    // Same work and same message whether or not the account exists.
    let ok = false;
    if (user && user.password_hash) ok = await auth.verifyPassword(password, user.password_hash);
    else await auth.burnPasswordCheck(password);

    if (!ok) return res.status(401).json({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
    auth.startSession(db, config, res, user.id);
    res.json({ user: auth.publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    auth.endSession(db, config, req, res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? auth.publicUser(req.user) : null });
  });

  router.post('/change-password', auth.requireAuth, strict, async (req, res) => {
    const body = bodyOf(req);
    const problem = passwordProblem(body.newPassword);
    if (problem) return res.status(400).json({ error: 'invalid_password', message: problem });

    if (req.user.password_hash) {
      const ok = typeof body.currentPassword === 'string'
        && await auth.verifyPassword(body.currentPassword.slice(0, 200), req.user.password_hash);
      if (!ok) return res.status(403).json({ error: 'wrong_password', message: 'Your current password is incorrect.' });
    }

    const hash = await auth.hashPassword(body.newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    // Sign out every other device but keep this one.
    auth.endAllSessions(db, req.user.id, req.cookies[auth.SESSION_COOKIE]);
    res.json({ ok: true });
  });

  router.post('/forgot-password', strict, async (req, res) => {
    if (!mailer.enabled) {
      return res.status(503).json({ error: 'email_unavailable', message: 'Password reset by email is not set up on this site yet.' });
    }
    const email = cleanEmail(bodyOf(req).email);
    const generic = { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
    if (!email) return res.json(generic);

    const user = findByEmail.get(email);
    if (user) {
      const token = auth.newToken();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(auth.hashToken(token), user.id, auth.nowSec() + 3600);
      const link = `${config.siteUrl}/reset.html?token=${encodeURIComponent(token)}`;
      mailer.send({ to: user.email, ...resetEmail({ name: user.name, link }) })
        .catch((err) => console.error('[mail] reset email failed:', err.message));
    }
    res.json(generic);
  });

  router.post('/reset-password', strict, async (req, res) => {
    const body = bodyOf(req);
    const problem = passwordProblem(body.password);
    if (problem) return res.status(400).json({ error: 'invalid_password', message: problem });
    const token = typeof body.token === 'string' ? body.token.slice(0, 200) : '';

    const row = token && db.prepare(
      'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?'
    ).get(auth.hashToken(token), auth.nowSec());
    if (!row) return res.status(400).json({ error: 'invalid_token', message: 'That reset link is invalid or has expired. Request a new one.' });

    const hash = await auth.hashPassword(body.password);
    db.transaction(() => {
      // The UPDATE guards against the same link being used twice at once.
      const used = db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
        .run(auth.nowSec(), row.token_hash);
      if (used.changes !== 1) throw Object.assign(new Error('token already used'), { code: 'TOKEN_USED' });
      // Opening the emailed link proves control of the inbox.
      db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hash, row.user_id);
      auth.endAllSessions(db, row.user_id);
    })();
    res.json({ ok: true });
  });

  router.use((err, req, res, next) => {
    if (err && err.code === 'TOKEN_USED') {
      return res.status(400).json({ error: 'invalid_token', message: 'That reset link has already been used.' });
    }
    next(err);
  });

  return router;
};
