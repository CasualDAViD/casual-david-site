'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, Client, signUp, uniqueEmail } = require('./helpers');

describe('password reset', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  const tokenFrom = (mail) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');

  test('full flow: request a link, set a new password, old password and old sessions stop working', async () => {
    const { client, email, password } = await signUp(srv, { name: 'Forgetful' });
    const before = srv.mailer.sent.length;

    const res = await new Client(srv.url).post('/api/auth/forgot-password', { email });
    assert.equal(res.status, 200);
    assert.equal(srv.mailer.sent.length, before + 1);
    const mail = srv.mailer.sent.at(-1);
    assert.equal(mail.to, email);
    assert.ok(mail.text.startsWith('Hi Forgetful'));
    assert.ok(mail.text.includes(`${srv.url}/reset.html?token=`));

    const token = tokenFrom(mail);
    const stored = srv.db.prepare('SELECT token_hash FROM password_resets').all().map((r) => r.token_hash);
    assert.ok(!stored.includes(token), 'the raw reset token is never stored');

    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { token, password: 'a-brand-new-pass' })).status, 200);

    assert.equal((await client.get('/api/auth/me')).json.user, null, 'old sessions are ended');
    assert.equal((await new Client(srv.url).post('/api/auth/login', { email, password })).status, 401);
    assert.equal((await new Client(srv.url).post('/api/auth/login', { email, password: 'a-brand-new-pass' })).status, 200);
  });

  test('a reset link only works once', async () => {
    const { email } = await signUp(srv);
    await new Client(srv.url).post('/api/auth/forgot-password', { email });
    const token = tokenFrom(srv.mailer.sent.at(-1));
    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { token, password: 'first-new-pass' })).status, 200);
    const second = await new Client(srv.url).post('/api/auth/reset-password', { token, password: 'second-new-pass' });
    assert.equal(second.status, 400);
    assert.equal(second.json.error, 'invalid_token');
  });

  test('expired and made-up tokens are rejected', async () => {
    const { email } = await signUp(srv);
    await new Client(srv.url).post('/api/auth/forgot-password', { email });
    const token = tokenFrom(srv.mailer.sent.at(-1));
    srv.db.prepare('UPDATE password_resets SET expires_at = 1').run();
    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { token, password: 'whatever-pass1' })).status, 400);
    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { token: 'made-up', password: 'whatever-pass1' })).status, 400);
    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { password: 'whatever-pass1' })).status, 400);
  });

  test('the new password must meet the same rules', async () => {
    const { email } = await signUp(srv);
    await new Client(srv.url).post('/api/auth/forgot-password', { email });
    const token = tokenFrom(srv.mailer.sent.at(-1));
    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { token, password: 'short' })).status, 400);
    // The link still works afterwards because the bad attempt did not use it up.
    assert.equal((await new Client(srv.url).post('/api/auth/reset-password', { token, password: 'long-enough-1' })).status, 200);
  });

  test('asking about an unknown email gives the same answer and sends nothing (no account enumeration)', async () => {
    const { email } = await signUp(srv);
    const before = srv.mailer.sent.length;
    const known = await new Client(srv.url).post('/api/auth/forgot-password', { email });
    const unknown = await new Client(srv.url).post('/api/auth/forgot-password', { email: uniqueEmail('ghost') });
    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.json, unknown.json);
    assert.equal(srv.mailer.sent.length, before + 1);
    assert.equal((await new Client(srv.url).post('/api/auth/forgot-password', { email: 'not-an-email' })).status, 200);
  });
});

describe('password reset without email set up', () => {
  test('reports that email is unavailable instead of pretending to send', async () => {
    const { loadConfig } = require('../server/config');
    const { createApp } = require('../server/index');
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-test-nomail-'));
    const config = loadConfig({}, { dataDir, mail: { host: '', from: '' } });
    const built = createApp(config);
    const server = await new Promise((r) => { const s = built.app.listen(0, '127.0.0.1', () => r(s)); });
    try {
      const c = new Client(`http://127.0.0.1:${server.address().port}`);
      assert.equal((await c.get('/api/config')).json.passwordReset, false);
      const res = await c.post('/api/auth/forgot-password', { email: 'a@example.com' });
      assert.equal(res.status, 503);
      assert.equal(res.json.error, 'email_unavailable');
    } finally {
      await new Promise((r) => server.close(r));
      built.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Google / Discord sign-in', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  // Runs the real redirect dance against the fake provider.
  async function signInWith(client, profile, { next = '/history.html', tamperState = false, code = 'abc' } = {}) {
    srv.oauth.state.profile = profile;
    const start = await client.get(`/api/auth/oauth/google?next=${encodeURIComponent(next)}`);
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    assert.equal(loc.origin + loc.pathname, 'https://accounts.example/auth');
    assert.equal(loc.searchParams.get('client_id'), 'gid');
    assert.equal(loc.searchParams.get('redirect_uri'), `${srv.url}/api/auth/oauth/google/callback`);
    assert.equal(loc.searchParams.get('response_type'), 'code');
    const state = loc.searchParams.get('state');
    assert.ok(state.length >= 20);
    return client.get(`/api/auth/oauth/google/callback?code=${code}&state=${tamperState ? 'forged' : state}`);
  }

  test('a new Google user gets an account and is signed in, then lands on the page they came from', async () => {
    const client = new Client(srv.url);
    const email = uniqueEmail('g');
    const res = await signInWith(client, { sub: 'g-1001', email, email_verified: true, name: 'Grace Hopper' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/history.html');

    const me = (await client.get('/api/auth/me')).json.user;
    assert.equal(me.email, email);
    assert.equal(me.name, 'Grace Hopper');
    assert.equal(me.hasPassword, false);
  });

  test('signing in again with the same Google account reuses the same user', async () => {
    const email = uniqueEmail('g');
    const profile = { sub: 'g-2002', email, email_verified: true, name: 'Same Person' };
    const a = new Client(srv.url); await signInWith(a, profile);
    const b = new Client(srv.url); await signInWith(b, profile);
    assert.equal((await a.get('/api/auth/me')).json.user.id, (await b.get('/api/auth/me')).json.user.id);
  });

  test('a forged or missing state is rejected (login CSRF protection)', async () => {
    const client = new Client(srv.url);
    const res = await signInWith(client, { sub: 'g-3003', email: uniqueEmail('g'), email_verified: true, name: 'X' }, { tamperState: true });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login\.html\?error=oauth_failed/);
    assert.equal((await client.get('/api/auth/me')).json.user, null);

    const noCookie = await new Client(srv.url).get('/api/auth/oauth/google/callback?code=abc&state=whatever');
    assert.match(noCookie.headers.get('location'), /error=oauth_failed/);
  });

  test('accounts whose email the provider has not verified are refused', async () => {
    const client = new Client(srv.url);
    const res = await signInWith(client, { sub: 'g-4004', email: uniqueEmail('g'), email_verified: false, name: 'Unverified' });
    assert.match(res.headers.get('location'), /error=oauth_unverified/);
    assert.equal((await client.get('/api/auth/me')).json.user, null);
  });

  test('provider errors and cancellations send the user back to login with a message', async () => {
    const client = new Client(srv.url);
    srv.oauth.state.tokenOk = false;
    try {
      const res = await signInWith(client, { sub: 'x', email: uniqueEmail('g'), email_verified: true });
      assert.match(res.headers.get('location'), /error=oauth_failed/);
    } finally {
      srv.oauth.state.tokenOk = true;
    }
    const cancelled = await client.get('/api/auth/oauth/google/callback?error=access_denied');
    assert.match(cancelled.headers.get('location'), /error=oauth_cancelled/);
  });

  test('the ?next= destination can only be a path on this site (no open redirect)', async () => {
    for (const evil of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const client = new Client(srv.url);
      const res = await signInWith(client, { sub: 'g-' + Math.random(), email: uniqueEmail('g'), email_verified: true, name: 'N' }, { next: evil });
      assert.equal(res.headers.get('location'), '/', `${evil} must fall back to /`);
    }
  });

  test('a Google user with the same verified email as an existing account is linked to it (one account, not two)', async () => {
    const { email, password } = await signUp(srv, { name: 'Has Password' });
    const userId = srv.db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

    const social = new Client(srv.url);
    await signInWith(social, { sub: 'g-5005', email, email_verified: true, name: 'Has Password' });

    assert.equal((await social.get('/api/auth/me')).json.user.id, userId);
    assert.equal(srv.db.prepare('SELECT COUNT(*) n FROM users WHERE email = ?').get(email).n, 1);

    // The password account was never email-verified, so the password is cleared
    // (see the takeover test below). The owner can use Google or reset by email.
    assert.equal((await new Client(srv.url).post('/api/auth/login', { email, password })).status, 401);
  });

  test('once an account is email-verified (e.g. after a reset), linking Google keeps its password', async () => {
    const { email, password } = await signUp(srv, { name: 'Verified' });
    srv.db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(email);
    const pw = new Client(srv.url);
    await pw.post('/api/auth/login', { email, password });

    const social = new Client(srv.url);
    await signInWith(social, { sub: 'g-5500', email, email_verified: true, name: 'Verified' });

    assert.equal((await social.get('/api/auth/me')).json.user.id, (await pw.get('/api/auth/me')).json.user.id);
    assert.equal((await new Client(srv.url).post('/api/auth/login', { email, password })).status, 200, 'password still works');
  });

  test('takeover protection: a password set by someone who never proved they own the email is wiped when the real owner signs in with Google', async () => {
    // An attacker registers the victim's address by password (it is never verified).
    const attacker = await signUp(srv, { email: uniqueEmail('victim'), password: 'attacker-knows-this' });
    const victimGoogle = new Client(srv.url);
    await signInWith(victimGoogle, { sub: 'g-6006', email: attacker.email, email_verified: true, name: 'Real Owner' });

    assert.equal((await attacker.client.get('/api/auth/me')).json.user, null, 'attacker session is ended');
    const retry = await new Client(srv.url).post('/api/auth/login', { email: attacker.email, password: 'attacker-knows-this' });
    assert.equal(retry.status, 401, 'attacker password no longer works');
    assert.ok((await victimGoogle.get('/api/auth/me')).json.user, 'real owner is signed in');
  });

  test('a provider that is not configured is simply not available', async () => {
    const res = await new Client(srv.url).get('/api/auth/oauth/discord');
    assert.equal(res.status, 404);
    assert.equal((await new Client(srv.url).get('/api/auth/oauth/facebook')).status, 404);
    assert.equal((await new Client(srv.url).get('/api/auth/oauth/__proto__')).status, 404);
  });
});
