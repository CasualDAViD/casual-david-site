'use strict';

const crypto = require('node:crypto');
const express = require('express');
const auth = require('../auth');
const { safeNext, cleanEmail, cleanName } = require('../validate');

const OAUTH_COOKIE = 'cd_oauth';
const SCOPES = { google: 'openid email profile', discord: 'identify email' };

// Turns each provider's profile into one shape. Returns null unless the
// provider vouches that the email address really belongs to the person.
function normalizeProfile(provider, raw) {
  if (provider === 'google') {
    if (!raw.sub || !raw.email || raw.email_verified !== true) return null;
    return { id: String(raw.sub), email: raw.email, name: raw.name || raw.email.split('@')[0] };
  }
  if (!raw.id || !raw.email || raw.verified !== true) return null;
  return { id: String(raw.id), email: raw.email, name: raw.global_name || raw.username || raw.email.split('@')[0] };
}

module.exports = function oauthRoutes({ db, config }) {
  const router = express.Router();

  const findIdentity = db.prepare('SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_user_id = ?');
  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');

  function redirectUri(provider) {
    return `${config.siteUrl}/api/auth/oauth/${provider}/callback`;
  }

  function fail(res, code) {
    res.clearCookie(OAUTH_COOKIE, { path: '/' });
    res.redirect(`/login.html?error=${code}`);
  }

  async function fetchProfile(provider, code) {
    const cfg = config.oauth[provider];
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(provider),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret
      }),
      signal: AbortSignal.timeout(15000)
    });
    const tokens = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokens?.access_token) throw new Error('token exchange failed');

    const userRes = await fetch(cfg.userUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
    const raw = await userRes.json().catch(() => null);
    if (!userRes.ok || !raw) throw new Error('profile lookup failed');
    return normalizeProfile(provider, raw);
  }

  // Finds the local account for this provider identity, creating or linking one.
  function resolveUser(provider, profile) {
    return db.transaction(() => {
      const linked = findIdentity.get(provider, profile.id);
      if (linked) return linked.user_id;

      const email = cleanEmail(profile.email);
      if (!email) return null;
      let user = findByEmail.get(email);

      if (user) {
        if (!user.email_verified) {
          // Someone may have registered this address by password without owning
          // it. The provider has now proven who really owns it, so drop that
          // password and any sessions it opened.
          db.prepare('UPDATE users SET password_hash = NULL, email_verified = 1 WHERE id = ?').run(user.id);
          auth.endAllSessions(db, user.id);
        }
      } else {
        const name = cleanName(profile.name) || email.split('@')[0];
        const id = db.prepare('INSERT INTO users (email, name, password_hash, email_verified) VALUES (?, ?, NULL, 1)')
          .run(email, name).lastInsertRowid;
        user = { id };
      }
      db.prepare('INSERT INTO oauth_identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)')
        .run(provider, profile.id, user.id);
      return user.id;
    })();
  }

  function knownProvider(req, res, next) {
    const provider = req.params.provider;
    if (!Object.hasOwn(SCOPES, provider) || !config.oauth[provider].enabled) {
      return res.status(404).json({ error: 'not_found', message: 'That sign-in method is not available.' });
    }
    req.provider = provider;
    next();
  }

  router.get('/:provider', knownProvider, (req, res) => {
    const state = crypto.randomBytes(24).toString('base64url');
    const next = safeNext(req.query.next) || '/';
    res.cookie(OAUTH_COOKIE, JSON.stringify({ state, next }), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: 10 * 60 * 1000
    });

    const cfg = config.oauth[req.provider];
    const url = new URL(cfg.authUrl);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirectUri(req.provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', SCOPES[req.provider]);
    url.searchParams.set('state', state);
    if (req.provider === 'google') url.searchParams.set('prompt', 'select_account');
    res.redirect(url.toString());
  });

  router.get('/:provider/callback', knownProvider, async (req, res) => {
    let saved = null;
    try { saved = JSON.parse(req.cookies?.[OAUTH_COOKIE] || 'null'); } catch { /* ignore */ }

    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const stateOk = saved && typeof saved.state === 'string' && saved.state.length === state.length
      && crypto.timingSafeEqual(Buffer.from(saved.state), Buffer.from(state));

    if (req.query.error) return fail(res, 'oauth_cancelled');
    if (!stateOk || !code) return fail(res, 'oauth_failed');

    try {
      const profile = await fetchProfile(req.provider, code);
      if (!profile) return fail(res, 'oauth_unverified');
      const userId = resolveUser(req.provider, profile);
      if (!userId) return fail(res, 'oauth_failed');

      auth.startSession(db, config, res, userId);
      res.clearCookie(OAUTH_COOKIE, { path: '/' });
      res.redirect(safeNext(saved.next) || '/');
    } catch (err) {
      console.error(`[oauth:${req.provider}]`, err.message);
      fail(res, 'oauth_failed');
    }
  });

  return router;
};
