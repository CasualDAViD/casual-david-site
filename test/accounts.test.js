'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, Client, signUp, makeAdmin, uniqueEmail } = require('./helpers');

describe('accounts and sessions', () => {
  let srv;
  before(async () => { srv = await startTestServer(); });
  after(async () => { await srv.close(); });

  test('signup creates an account, signs the user in, and never stores the plain password', async () => {
    const { client, email, user } = await signUp(srv, { name: 'Ada Lovelace', password: 'correct horse battery' });
    assert.equal(user.email, email);
    assert.equal(user.role, 'user');

    const me = await client.get('/api/auth/me');
    assert.equal(me.json.user.name, 'Ada Lovelace');

    const row = srv.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.ok(!row.password_hash.includes('correct horse battery'));
  });

  test('the session cookie is HttpOnly and only its hash is stored', async () => {
    const client = new Client(srv.url);
    const res = await client.post('/api/auth/signup', { name: 'Cookie', email: uniqueEmail(), password: 'password123' });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('cd_session='));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);

    const token = client.cookies.get('cd_session');
    const stored = srv.db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
    assert.ok(!stored.includes(token), 'raw token must not be in the database');
  });

  test('duplicate emails are rejected, case-insensitively', async () => {
    const { email } = await signUp(srv);
    const res = await new Client(srv.url).post('/api/auth/signup', { name: 'Dup', email: email.toUpperCase(), password: 'password123' });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'email_taken');
  });

  test('bad signup input is rejected with a clear message', async () => {
    const c = new Client(srv.url);
    assert.equal((await c.post('/api/auth/signup', { name: 'A', email: 'not-an-email', password: 'password123' })).status, 400);
    assert.equal((await c.post('/api/auth/signup', { name: '', email: uniqueEmail(), password: 'password123' })).status, 400);
    const short = await c.post('/api/auth/signup', { name: 'A', email: uniqueEmail(), password: 'short' });
    assert.equal(short.status, 400);
    assert.match(short.json.message, /8 characters/);
    assert.equal((await c.post('/api/auth/signup', { name: 'A', email: uniqueEmail(), password: ['x'] })).status, 400);
    assert.equal((await c.request('POST', '/api/auth/signup', { raw: 'not json', headers: { 'Content-Type': 'application/json' } })).status, 400);
  });

  test('login works with the right password and fails with the same message for a wrong password or unknown email', async () => {
    const { email, password } = await signUp(srv);

    const good = await new Client(srv.url).post('/api/auth/login', { email, password });
    assert.equal(good.status, 200);

    const wrong = await new Client(srv.url).post('/api/auth/login', { email, password: 'nope-nope-nope' });
    const unknown = await new Client(srv.url).post('/api/auth/login', { email: uniqueEmail('ghost'), password });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.json.message, unknown.json.message);
  });

  test('logout ends the session on the server', async () => {
    const { client } = await signUp(srv);
    const saved = client.cookies.get('cd_session');
    await client.post('/api/auth/logout', {});
    assert.equal((await client.get('/api/auth/me')).json.user, null);

    // Replaying the old cookie must not work either.
    const replay = new Client(srv.url);
    replay.cookies.set('cd_session', saved);
    assert.equal((await replay.get('/api/auth/me')).json.user, null);
  });

  test('expired sessions are not accepted', async () => {
    const { client } = await signUp(srv);
    srv.db.prepare('UPDATE sessions SET expires_at = 1').run();
    assert.equal((await client.get('/api/auth/me')).json.user, null);
  });

  test('changing the password needs the current one and signs out other devices', async () => {
    const { client, email, password } = await signUp(srv);
    const other = new Client(srv.url);
    await other.post('/api/auth/login', { email, password });

    assert.equal((await client.post('/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'brandnewpass1' })).status, 403);
    const ok = await client.post('/api/auth/change-password', { currentPassword: password, newPassword: 'brandnewpass1' });
    assert.equal(ok.status, 200);

    assert.equal((await client.get('/api/auth/me')).json.user.email, email, 'this device stays signed in');
    assert.equal((await other.get('/api/auth/me')).json.user, null, 'other device is signed out');
    assert.equal((await new Client(srv.url).post('/api/auth/login', { email, password })).status, 401);
    assert.equal((await new Client(srv.url).post('/api/auth/login', { email, password: 'brandnewpass1' })).status, 200);
  });

  test('change-password requires being signed in', async () => {
    const res = await new Client(srv.url).post('/api/auth/change-password', { currentPassword: 'a', newPassword: 'longenough1' });
    assert.equal(res.status, 401);
  });

  test('requests from another site are blocked (Origin check)', async () => {
    const c = new Client(srv.url);
    const evil = await c.post('/api/auth/signup', { name: 'X', email: uniqueEmail(), password: 'password123' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const same = await c.post('/api/auth/signup', { name: 'X', email: uniqueEmail(), password: 'password123' }, { headers: { Origin: srv.url } });
    assert.equal(same.status, 201);
  });

  test('admin routes: anonymous gets 401, normal user gets 403, admin gets in', async () => {
    assert.equal((await new Client(srv.url).get('/api/admin/mods')).status, 401);
    const { client: user } = await signUp(srv);
    assert.equal((await user.get('/api/admin/mods')).status, 403);
    assert.equal((await user.get('/api/admin/orders')).status, 403);
    assert.equal((await user.put('/api/admin/socials', { youtube: 'https://youtube.com/x' })).status, 403);
    const admin = await makeAdmin(srv);
    assert.equal((await admin.client.get('/api/admin/mods')).status, 200);
  });

  test('a user cannot make themselves admin through any input', async () => {
    const { client, email } = await signUp(srv);
    await client.post('/api/auth/signup', { name: 'x', email: uniqueEmail(), password: 'password123', role: 'admin' });
    await client.post('/api/auth/change-password', { currentPassword: 'password123', newPassword: 'password456', role: 'admin' });
    const role = srv.db.prepare('SELECT role FROM users WHERE email = ?').get(email).role;
    assert.equal(role, 'user');

    const sneaky = new Client(srv.url);
    const res = await sneaky.post('/api/auth/signup', { name: 'Sneaky', email: uniqueEmail(), password: 'password123', role: 'admin' });
    assert.equal(res.json.user.role, 'user');
  });

  test('config endpoint only switches features on when they are set up', async () => {
    const cfg = (await new Client(srv.url).get('/api/config')).json;
    assert.equal(cfg.payments, true);
    assert.equal(cfg.oauth.google, true);
    assert.equal(cfg.oauth.discord, false);
    assert.equal(cfg.passwordReset, true); // the test mailer is enabled
    assert.equal(JSON.stringify(cfg).includes('secret'), false, 'no secrets in the public config');
  });

  test('server code, database and data folder are not reachable over HTTP', async () => {
    const c = new Client(srv.url);
    for (const p of ['/server/index.js', '/package.json', '/data/site.db', '/.env', '/../package.json', '/%2e%2e/package.json', '/scripts/create-admin.js']) {
      const res = await c.get(p);
      assert.equal(res.status, 404, `${p} should be 404 but was ${res.status}`);
    }
    assert.equal((await c.get('/api/does-not-exist')).status, 404);
    assert.equal((await c.get('/')).status, 200);
    assert.equal((await c.get('/login.html')).status, 200);
  });

  test('security headers are set', async () => {
    const res = await new Client(srv.url).get('/');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('login rate limit', () => {
  let srv;
  before(async () => { srv = await startTestServer({ rateLimit: 4 }); });
  after(async () => { await srv.close(); });

  test('too many failed logins from one address get blocked, even with the right password afterwards', async () => {
    const { email, password } = await signUp(srv);
    const c = new Client(srv.url);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await c.post('/api/auth/login', { email, password: 'wrong-wrong' })).status);
    assert.deepEqual(codes.slice(0, 4), [401, 401, 401, 401]);
    assert.ok(codes.slice(4).every((s) => s === 429), `expected 429s, got ${codes}`);
    assert.equal((await c.post('/api/auth/login', { email, password })).status, 429);
  });
});
