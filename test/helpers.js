'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const { loadConfig } = require('../server/config');
const { createApp } = require('../server/index');
const { hashPassword } = require('../server/auth');

const PAYSTACK_SECRET = 'sk_test_secret_for_tests';

// A tiny stand-in for Paystack's API so no test ever touches the real one.
function startFakePaystack() {
  const state = { initialized: [], verifyResult: {}, failInitialize: false };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, json) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== `Bearer ${PAYSTACK_SECRET}`) return send(401, { status: false, message: 'bad key' });

      if (req.method === 'POST' && req.url === '/transaction/initialize') {
        if (state.failInitialize) return send(500, { status: false, message: 'boom' });
        const data = JSON.parse(body);
        state.initialized.push(data);
        return send(200, { status: true, data: {
          authorization_url: `https://checkout.paystack.test/${data.reference}`,
          access_code: 'ac', reference: data.reference
        }});
      }
      const m = req.url.match(/^\/transaction\/verify\/(.+)$/);
      if (req.method === 'GET' && m) {
        const ref = decodeURIComponent(m[1]);
        const found = state.initialized.find((i) => i.reference === ref);
        if (!found) return send(404, { status: false, message: 'Transaction reference not found' });
        const override = state.verifyResult[ref] || {};
        return send(200, { status: true, data: {
          reference: ref, status: 'success', amount: found.amount, currency: 'NGN', ...override
        }});
      }
      send(404, { status: false, message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
  }));
}

// A stand-in for the Google / Discord token and profile endpoints.
function startFakeOAuth() {
  const state = { profile: null, tokenOk: true };
  const server = http.createServer((req, res) => {
    const send = (code, json) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (req.url === '/token') return state.tokenOk ? send(200, { access_token: 'tok123' }) : send(400, { error: 'bad_code' });
    if (req.url === '/user') return send(200, state.profile || {});
    send(404, {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ state, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
  }));
}

function fakeMailer() {
  const sent = [];
  return { enabled: true, sent, async send(message) { sent.push(message); return true; } };
}

// Boots the whole app on a random port with a throwaway data folder.
async function startTestServer(options = {}) {
  const paystack = await startFakePaystack();
  const oauth = await startFakeOAuth();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-test-'));
  const mailer = fakeMailer();

  const overrides = {
    dataDir,
    rateLimit: { windowMs: 60000, limit: options.rateLimit || 1000 },
    paystack: { secretKey: PAYSTACK_SECRET, publicKey: 'pk_test_x', apiBase: paystack.url },
    oauth: {
      google: { clientId: 'gid', clientSecret: 'gsecret', authUrl: 'https://accounts.example/auth', tokenUrl: `${oauth.url}/token`, userUrl: `${oauth.url}/user` },
      discord: { clientId: '', clientSecret: '' }
    },
    ...(options.overrides || {})
  };
  const config = loadConfig({ NODE_ENV: 'test' }, overrides);
  const built = createApp(config, { mailer });
  const server = await new Promise((resolve) => {
    const s = built.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  config.siteUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    ...built, config, paystack, oauth, mailer,
    url: config.siteUrl,
    async close() {
      await new Promise((r) => server.close(r));
      built.close();
      paystack.close();
      oauth.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

// A minimal browser: keeps cookies between requests.
class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  async request(method, url, { json, form, headers = {}, raw, redirect = 'manual' } = {}) {
    const h = { ...headers };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.Cookie = cookie;
    let body;
    if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form;
    else if (raw !== undefined) body = raw;

    const res = await fetch(this.baseUrl + url, { method, headers: h, body, redirect });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const type = res.headers.get('content-type') || '';
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: res.headers,
      buffer,
      text: buffer.toString('utf8'),
      json: type.includes('json') ? JSON.parse(buffer.toString('utf8')) : null
    };
  }

  get(url, opts) { return this.request('GET', url, opts); }
  post(url, json, opts) { return this.request('POST', url, { json, ...opts }); }
  put(url, json, opts) { return this.request('PUT', url, { json, ...opts }); }
  delete(url, opts) { return this.request('DELETE', url, opts); }
}

let counter = 0;
const uniqueEmail = (prefix = 'user') => `${prefix}${++counter}-${crypto.randomBytes(3).toString('hex')}@example.com`;

async function signUp(srv, { name = 'Test User', email = uniqueEmail(), password = 'password123' } = {}) {
  const client = new Client(srv.url);
  const res = await client.post('/api/auth/signup', { name, email, password });
  if (res.status !== 201) throw new Error('signup failed: ' + res.text);
  return { client, email, password, user: res.json.user };
}

async function makeAdmin(srv, { email = uniqueEmail('admin'), password = 'adminpass123' } = {}) {
  const hash = await hashPassword(password);
  srv.db.prepare("INSERT INTO users (email, name, password_hash, role, email_verified) VALUES (?, 'Admin', ?, 'admin', 1)").run(email, hash);
  const client = new Client(srv.url);
  const res = await client.post('/api/auth/login', { email, password });
  if (res.status !== 200) throw new Error('admin login failed: ' + res.text);
  return { client, email, password };
}

// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function modForm({
  name = 'Cool Mod', summary = 'Does cool things.', description = 'Does cool things, in detail.', price = '5.00',
  className = 'Mods', mainCategory = 'Utility & QoL', extraCategories, links, unlisted, license,
  icon, file, screenshots = [], extra = {}
} = {}) {
  const fd = new FormData();
  fd.set('name', name);
  fd.set('summary', summary);
  fd.set('description', description);
  fd.set('price', price);
  fd.set('class', className);
  fd.set('mainCategory', mainCategory);
  if (extraCategories !== undefined) fd.set('extraCategories', JSON.stringify(extraCategories));
  if (links !== undefined) fd.set('links', JSON.stringify(links));
  if (unlisted !== undefined) fd.set('unlisted', String(unlisted));
  if (license !== undefined) fd.set('license', license);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  if (icon) fd.set('icon', new Blob([icon.data], { type: 'image/png' }), icon.name || 'icon.png');
  if (file) fd.set('file', new Blob([file.data]), file.name || 'cool-mod.jar');
  screenshots.forEach((s, i) => fd.append('screenshots', new Blob([s.data], { type: 'image/png' }), s.name || `shot${i}.png`));
  return fd;
}

// The form for "Upload New File". Lists are sent as JSON text, like the browser does.
function fileForm({
  file = { data: Buffer.from('JAR-CONTENT-123'), name: 'cool-mod-1.0.jar' }, displayName, releaseType, publish,
  environments = ['Client'], modloaders = ['Fabric'], javaVersions, gameVersions = ['1.21.11'],
  changelog, dependencies, extra = {}
} = {}) {
  const fd = new FormData();
  if (file) fd.set('file', new Blob([file.data]), file.name || 'cool-mod-1.0.jar');
  const set = (k, v) => { if (v !== undefined) fd.set(k, v); };
  set('displayName', displayName);
  set('releaseType', releaseType);
  set('publish', publish);
  set('environments', JSON.stringify(environments));
  set('modloaders', JSON.stringify(modloaders));
  if (javaVersions !== undefined) set('javaVersions', JSON.stringify(javaVersions));
  set('gameVersions', JSON.stringify(gameVersions));
  set('changelog', changelog);
  if (dependencies !== undefined) set('dependencies', JSON.stringify(dependencies));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

async function addFile(admin, modId, opts) {
  return admin.client.request('POST', `/api/admin/mods/${modId}/files`, { form: fileForm(opts) });
}

async function createMod(admin, opts = {}) {
  const withFile = opts.withFile !== false;
  const fd = modForm({ icon: { data: PNG }, ...opts.form });
  const res = await admin.client.request('POST', '/api/admin/mods', { form: fd });
  if (res.status !== 201) throw new Error('create mod failed: ' + res.text);
  if (withFile) {
    const f = await addFile(admin, res.json.mod.id, { file: { data: opts.fileData || Buffer.from('JAR-CONTENT-123'), name: 'cool-mod-1.0.jar' } });
    if (f.status !== 201) throw new Error('add file failed: ' + f.text);
    return (await admin.client.get('/api/admin/mods')).json.mods.find((m) => m.id === res.json.mod.id);
  }
  return res.json.mod;
}

function webhookSignature(body) {
  return crypto.createHmac('sha512', PAYSTACK_SECRET).update(body).digest('hex');
}

module.exports = {
  startTestServer, Client, signUp, makeAdmin, createMod, modForm, fileForm, addFile, uniqueEmail,
  webhookSignature, PNG, PAYSTACK_SECRET
};
