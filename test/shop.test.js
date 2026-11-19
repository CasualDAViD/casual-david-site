'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startTestServer, Client, signUp, makeAdmin, createMod, modForm, webhookSignature, PNG
} = require('./helpers');

describe('admin: mods, uploads and socials', () => {
  let srv, admin;
  before(async () => { srv = await startTestServer(); admin = await makeAdmin(srv); });
  after(async () => { await srv.close(); });

  test('admin can create a mod with an icon, screenshots and a downloadable file', async () => {
    const fd = modForm({
      name: 'Casual QoL Pack', description: 'Quality of life.', price: '4.99', className: 'Plugins', mainCategory: 'Economy',
      icon: { data: PNG }, file: { data: Buffer.from('PK-fake-jar'), name: 'qol.jar' },
      screenshots: [{ data: PNG }, { data: PNG }]
    });
    const res = await admin.client.request('POST', '/api/admin/mods', { form: fd });
    assert.equal(res.status, 201, res.text);
    const mod = res.json.mod;
    assert.equal(mod.price, 4.99);
    assert.equal(mod.class, 'Plugins');
    assert.equal(mod.mainCategory, 'Economy');
    assert.equal(mod.available, true);
    assert.equal(mod.fileName, 'qol.jar');
    assert.equal(mod.screenshots.length, 2);
    assert.match(mod.icon, /^\/uploads\/[0-9a-f]{32}\.png$/);

    // Images are public; the mod file is not.
    const img = await new Client(srv.url).get(mod.icon);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(img.buffer, PNG);
  });

  test('the public catalogue shows the mod but never leaks the file location', async () => {
    const mod = await createMod(admin, { form: { name: 'Public Mod' } });
    const list = (await new Client(srv.url).get('/api/mods')).json.mods;
    const found = list.find((m) => m.id === mod.id);
    assert.ok(found);
    assert.equal(found.available, true);
    const raw = JSON.stringify(found);
    assert.ok(!raw.includes('private-files') && !raw.includes('file_stored') && !raw.includes('.jar'));
    assert.equal(found.fileName, undefined);
    assert.equal(found.sales, undefined);

    const stored = srv.db.prepare('SELECT file_stored FROM mods WHERE id = ?').get(mod.id).file_stored;
    const probe = new Client(srv.url);
    for (const p of [`/uploads/${stored}`, `/private-files/${stored}`, `/data/private-files/${stored}`]) {
      assert.notEqual((await probe.get(p)).status, 200, `${p} must not be public`);
    }
    const detail = await probe.get(`/api/mods/${mod.id}`);
    assert.equal(detail.status, 200);
    assert.equal((await probe.get('/api/mods/nope')).status, 404);
  });

  test('a mod without a file is listed but marked unavailable', async () => {
    const mod = await createMod(admin, { withFile: false, form: { name: 'No File Yet' } });
    assert.equal(mod.available, false);
    const found = (await new Client(srv.url).get('/api/mods')).json.mods.find((m) => m.id === mod.id);
    assert.equal(found.available, false);
  });

  test('uploads are validated: fake images, wrong file types and bad prices are rejected and leave nothing behind', async () => {
    const before = fs.readdirSync(srv.models.uploadsDir).length;
    const beforePrivate = fs.readdirSync(srv.models.filesDir).length;

    const fakeImage = modForm({ icon: { data: Buffer.from('<svg onload=alert(1)>'), name: 'evil.png' } });
    let res = await admin.client.request('POST', '/api/admin/mods', { form: fakeImage });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /PNG, JPG, GIF or WebP/);

    const badFile = modForm({ icon: { data: PNG }, file: { data: Buffer.from('MZ...'), name: 'virus.exe' } });
    res = await admin.client.request('POST', '/api/admin/mods', { form: badFile });
    assert.equal(res.status, 400);
    assert.match(res.json.message, /Mod files must be one of/);

    for (const price of ['0', '-3', 'abc', '']) {
      res = await admin.client.request('POST', '/api/admin/mods', { form: modForm({ price, icon: { data: PNG } }) });
      assert.equal(res.status, 400, `price ${JSON.stringify(price)} should be rejected`);
    }
    res = await admin.client.request('POST', '/api/admin/mods', { form: modForm({ name: '   ', icon: { data: PNG } }) });
    assert.equal(res.status, 400);
    res = await admin.client.request('POST', '/api/admin/mods', { form: modForm({ className: 'Hack', icon: { data: PNG } }) });
    assert.equal(res.status, 400);

    assert.equal(fs.readdirSync(srv.models.uploadsDir).length, before, 'no stray images');
    assert.equal(fs.readdirSync(srv.models.filesDir).length, beforePrivate, 'no stray mod files');
    assert.equal(fs.readdirSync(srv.models.tmpDir).length, 0, 'tmp folder is clean');
  });

  test('editing keeps the old file unless a new one is uploaded, and replacing deletes the old file from disk', async () => {
    const mod = await createMod(admin, { form: { name: 'Editable' }, fileData: Buffer.from('v1') });
    const oldStored = srv.db.prepare('SELECT file_stored FROM mods WHERE id = ?').get(mod.id).file_stored;

    let res = await admin.client.request('PUT', `/api/admin/mods/${mod.id}`, { form: modForm({ name: 'Edited name', price: '9.50' }) });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.mod.name, 'Edited name');
    assert.equal(res.json.mod.price, 9.5);
    assert.equal(res.json.mod.available, true);
    assert.equal(srv.db.prepare('SELECT file_stored FROM mods WHERE id = ?').get(mod.id).file_stored, oldStored);

    res = await admin.client.request('PUT', `/api/admin/mods/${mod.id}`, { form: modForm({ file: { data: Buffer.from('v2'), name: 'v2.jar' } }) });
    assert.equal(res.status, 200);
    const newStored = srv.db.prepare('SELECT file_stored FROM mods WHERE id = ?').get(mod.id).file_stored;
    assert.notEqual(newStored, oldStored);
    assert.equal(fs.existsSync(path.join(srv.models.filesDir, oldStored)), false, 'old file removed');
    assert.equal(fs.readFileSync(path.join(srv.models.filesDir, newStored), 'utf8'), 'v2');

    assert.equal((await admin.client.request('PUT', '/api/admin/mods/mod-missing', { form: modForm() })).status, 404);
  });

  test('screenshots can be added, individually removed, and cleared', async () => {
    const mod = await createMod(admin, { form: { name: 'Shots', screenshots: [{ data: PNG }, { data: PNG }] } });
    assert.equal(mod.screenshots.length, 2);

    let res = await admin.client.request('PUT', `/api/admin/mods/${mod.id}`, { form: modForm({ screenshots: [{ data: PNG }] }) });
    assert.equal(res.json.mod.screenshots.length, 3);

    const del = await admin.client.delete(`/api/admin/mods/${mod.id}/screenshots/${res.json.mod.screenshotIds[0]}`);
    assert.equal(del.status, 200);
    res = await admin.client.get('/api/admin/mods');
    assert.equal(res.json.mods.find((m) => m.id === mod.id).screenshots.length, 2);

    res = await admin.client.request('PUT', `/api/admin/mods/${mod.id}`, { form: modForm({ extra: { clearScreenshots: 'true' } }) });
    assert.equal(res.json.mod.screenshots.length, 0);
  });

  test('deleting hides a mod from the shop (soft delete)', async () => {
    const mod = await createMod(admin, { form: { name: 'Doomed' } });
    assert.equal((await admin.client.delete(`/api/admin/mods/${mod.id}`)).status, 200);
    assert.equal((await new Client(srv.url).get(`/api/mods/${mod.id}`)).status, 404);
    assert.ok(!(await new Client(srv.url).get('/api/mods')).json.mods.some((m) => m.id === mod.id));
    assert.equal((await admin.client.delete(`/api/admin/mods/${mod.id}`)).status, 404);
  });

  test('oversized uploads are refused with a clear message', async () => {
    const small = await startTestServer({ overrides: { maxModFileMb: 1 } });
    try {
      const a = await makeAdmin(small);
      const fd = modForm({ icon: { data: PNG }, file: { data: Buffer.alloc(2 * 1024 * 1024, 1), name: 'big.jar' } });
      const res = await a.client.request('POST', '/api/admin/mods', { form: fd });
      assert.equal(res.status, 413);
      assert.match(res.json.message, /too large/);
      assert.equal(fs.readdirSync(small.models.tmpDir).length, 0);
    } finally {
      await small.close();
    }
  });

  test('social links: saved by the admin, public to everyone, and only safe URLs are accepted', async () => {
    const body = {
      youtube: 'https://youtube.com/@casual', youtubeHandle: '@Casual_DAViD', tiktok: 'https://tiktok.com/@casual',
      discord: 'https://discord.gg/abc', personalDiscord: 'https://discord.com/users/1', email: 'Me@Example.com', donate: 'https://ko-fi.com/me'
    };
    const res = await admin.client.put('/api/admin/socials', body);
    assert.equal(res.status, 200);
    assert.equal(res.json.email, 'me@example.com');

    const pub = (await new Client(srv.url).get('/api/socials')).json;
    assert.equal(pub.discord, 'https://discord.gg/abc');
    assert.equal(pub.personalDiscord, 'https://discord.com/users/1', 'fields the old demo silently dropped are now saved');
    assert.equal(pub.donate, 'https://ko-fi.com/me');

    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.example', 'not a url']) {
      const r = await admin.client.put('/api/admin/socials', { youtube: bad });
      assert.equal(r.status, 400, `${bad} must be rejected`);
    }
    assert.equal((await admin.client.put('/api/admin/socials', { email: 'nope' })).status, 400);
  });

  test('admin order list works', async () => {
    const res = await admin.client.get('/api/admin/orders');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.orders));
  });
});

describe('payments, webhooks and downloads', () => {
  let srv, admin;
  before(async () => { srv = await startTestServer(); admin = await makeAdmin(srv); });
  after(async () => { await srv.close(); });

  const startOrder = async (client, modId) => client.post('/api/orders', { modId });

  test('buying needs an account', async () => {
    const mod = await createMod(admin);
    assert.equal((await new Client(srv.url).post('/api/orders', { modId: mod.id })).status, 401);
  });

  test('an order charges the right naira amount and sends the buyer to Paystack', async () => {
    const mod = await createMod(admin, { form: { price: '5.00' } });
    const { client, email } = await signUp(srv);
    const res = await startOrder(client, mod.id);
    assert.equal(res.status, 201, res.text);
    assert.match(res.json.authorizationUrl, /^https:\/\/checkout\.paystack\.test\//);

    const sent = srv.paystack.state.initialized.at(-1);
    assert.equal(sent.amount, 5 * 1550 * 100, '$5 at 1550 NGN/USD is 7,750 NGN = 775,000 kobo');
    assert.equal(sent.currency, 'NGN');
    assert.equal(sent.email, email);
    assert.equal(sent.reference, res.json.reference);
    assert.equal(sent.callback_url, `${srv.url}/order-complete.html`);
  });

  test('the price comes from the server: the browser cannot choose it', async () => {
    const mod = await createMod(admin, { form: { price: '10.00' } });
    const { client } = await signUp(srv);
    await client.post('/api/orders', { modId: mod.id, amount: 1, price: 0.01, amountKobo: 100 });
    assert.equal(srv.paystack.state.initialized.at(-1).amount, 10 * 1550 * 100);
  });

  test('cannot buy a missing mod, or one with no file yet', async () => {
    const { client } = await signUp(srv);
    assert.equal((await startOrder(client, 'mod-nope')).status, 404);
    const noFile = await createMod(admin, { withFile: false });
    const res = await startOrder(client, noFile.id);
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'not_available');
  });

  test('if Paystack is down the order is marked failed and the buyer sees a friendly error', async () => {
    const mod = await createMod(admin);
    const { client } = await signUp(srv);
    srv.paystack.state.failInitialize = true;
    try {
      const res = await startOrder(client, mod.id);
      assert.equal(res.status, 502);
      assert.equal(res.json.error, 'payment_start_failed');
    } finally {
      srv.paystack.state.failInitialize = false;
    }
    const orders = srv.db.prepare('SELECT status FROM orders ORDER BY id DESC LIMIT 1').get();
    assert.equal(orders.status, 'failed');
  });

  test('full purchase: download is locked, then unlocked after Paystack confirms the payment', async () => {
    const mod = await createMod(admin, { fileData: Buffer.from('THE-SECRET-MOD-BYTES') });
    const { client, email } = await signUp(srv, { name: 'Buyer Bob' });

    // Locked before paying.
    assert.equal((await client.get(`/api/downloads/${mod.id}`)).status, 403);
    assert.equal((await new Client(srv.url).get(`/api/downloads/${mod.id}`)).status, 401);

    const order = (await startOrder(client, mod.id)).json;

    // Still locked while pending.
    assert.equal((await client.get(`/api/downloads/${mod.id}`)).status, 403);
    assert.equal((await client.get('/api/orders')).json.orders.length, 0);

    const before = srv.mailer.sent.length;
    const verify = await client.get(`/api/orders/verify?reference=${order.reference}`);
    assert.equal(verify.json.status, 'paid');
    assert.equal(verify.json.modName, mod.name);

    const dl = await client.get(`/api/downloads/${mod.id}`);
    assert.equal(dl.status, 200);
    assert.equal(dl.text, 'THE-SECRET-MOD-BYTES');
    assert.match(dl.headers.get('content-disposition'), /^attachment; filename="?[^";]+\.jar"?$/);
    assert.match(dl.headers.get('cache-control'), /no-store/);

    const history = (await client.get('/api/orders')).json.orders;
    assert.equal(history.length, 1);
    assert.equal(history[0].mod.id, mod.id);
    assert.equal(history[0].mod.downloadable, true);
    assert.equal(history[0].amountKobo, Math.round(5 * 1550 * 100));

    // One receipt, to the buyer, with the reference in it.
    assert.equal(srv.mailer.sent.length, before + 1);
    const mail = srv.mailer.sent.at(-1);
    assert.equal(mail.to, email);
    assert.ok(mail.text.includes(order.reference));
    assert.match(mail.subject, new RegExp(mod.name));

    // Verifying again changes nothing and sends no second receipt.
    await client.get(`/api/orders/verify?reference=${order.reference}`);
    assert.equal(srv.mailer.sent.length, before + 1);

    // Already owned.
    const again = await startOrder(client, mod.id);
    assert.equal(again.status, 409);
    assert.equal(again.json.error, 'already_owned');
  });

  test('another user cannot download what someone else bought, or look at their order', async () => {
    const mod = await createMod(admin);
    const buyer = await signUp(srv);
    const order = (await startOrder(buyer.client, mod.id)).json;
    await buyer.client.get(`/api/orders/verify?reference=${order.reference}`);

    const stranger = await signUp(srv);
    assert.equal((await stranger.client.get(`/api/downloads/${mod.id}`)).status, 403);
    assert.equal((await stranger.client.get(`/api/orders/verify?reference=${order.reference}`)).status, 404);
    assert.equal((await stranger.client.get('/api/orders')).json.orders.length, 0);
  });

  test('admin can download any mod file', async () => {
    const mod = await createMod(admin, { fileData: Buffer.from('ADMIN-COPY') });
    const res = await admin.client.get(`/api/downloads/${mod.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.text, 'ADMIN-COPY');
  });

  test('a payment for the wrong amount is NOT treated as paid', async () => {
    const mod = await createMod(admin);
    const { client } = await signUp(srv);
    const order = (await startOrder(client, mod.id)).json;
    srv.paystack.state.verifyResult[order.reference] = { amount: 100 }; // paid 1 naira

    const res = await client.get(`/api/orders/verify?reference=${order.reference}`);
    assert.equal(res.json.status, 'pending');
    assert.equal((await client.get(`/api/downloads/${mod.id}`)).status, 403);
  });

  test('abandoned payments stay pending, failed payments are marked failed', async () => {
    const mod = await createMod(admin);
    const { client } = await signUp(srv);

    const a = (await startOrder(client, mod.id)).json;
    srv.paystack.state.verifyResult[a.reference] = { status: 'abandoned' };
    assert.equal((await client.get(`/api/orders/verify?reference=${a.reference}`)).json.status, 'pending');

    const f = (await startOrder(client, mod.id)).json;
    srv.paystack.state.verifyResult[f.reference] = { status: 'failed' };
    assert.equal((await client.get(`/api/orders/verify?reference=${f.reference}`)).json.status, 'failed');
  });

  test('webhook: rejects bad or missing signatures', async () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'CD_x' } });
    const c = new Client(srv.url);
    const none = await c.request('POST', '/api/paystack/webhook', { raw: body, headers: { 'Content-Type': 'application/json' } });
    assert.equal(none.status, 401);
    const bad = await c.request('POST', '/api/paystack/webhook', { raw: body, headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'deadbeef' } });
    assert.equal(bad.status, 401);
    const wrongBody = await c.request('POST', '/api/paystack/webhook', {
      raw: body + ' ', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': webhookSignature(body) }
    });
    assert.equal(wrongBody.status, 401, 'signature must cover the exact bytes');
  });

  test('webhook: a signed charge.success unlocks the download even if the buyer never came back', async () => {
    const mod = await createMod(admin);
    const { client } = await signUp(srv);
    const order = (await startOrder(client, mod.id)).json;

    const body = JSON.stringify({ event: 'charge.success', data: { reference: order.reference } });
    const hook = () => new Client(srv.url).request('POST', '/api/paystack/webhook', {
      raw: body, headers: { 'Content-Type': 'application/json', 'x-paystack-signature': webhookSignature(body) }
    });

    const mailsBefore = srv.mailer.sent.length;
    assert.equal((await hook()).status, 200);
    assert.equal((await client.get(`/api/downloads/${mod.id}`)).status, 200);
    assert.equal(srv.mailer.sent.length, mailsBefore + 1);

    // Paystack retries; nothing changes and no duplicate receipt.
    assert.equal((await hook()).status, 200);
    assert.equal(srv.mailer.sent.length, mailsBefore + 1);
    assert.equal(srv.db.prepare("SELECT COUNT(*) n FROM orders WHERE reference = ? AND status = 'paid'").get(order.reference).n, 1);
  });

  test('webhook: a forged "success" for an unpaid order does nothing, because we re-check with Paystack', async () => {
    const mod = await createMod(admin);
    const { client } = await signUp(srv);
    const order = (await startOrder(client, mod.id)).json;
    srv.paystack.state.verifyResult[order.reference] = { status: 'abandoned' };

    const body = JSON.stringify({ event: 'charge.success', data: { reference: order.reference, amount: 999999 } });
    await new Client(srv.url).request('POST', '/api/paystack/webhook', {
      raw: body, headers: { 'Content-Type': 'application/json', 'x-paystack-signature': webhookSignature(body) }
    });
    assert.equal((await client.get(`/api/downloads/${mod.id}`)).status, 403);
  });

  test('buyers keep access to a mod after the admin deletes it from the shop', async () => {
    const mod = await createMod(admin, { fileData: Buffer.from('KEEP-ME') });
    const { client } = await signUp(srv);
    const order = (await startOrder(client, mod.id)).json;
    await client.get(`/api/orders/verify?reference=${order.reference}`);

    await admin.client.delete(`/api/admin/mods/${mod.id}`);
    const dl = await client.get(`/api/downloads/${mod.id}`);
    assert.equal(dl.status, 200);
    assert.equal(dl.text, 'KEEP-ME');
    assert.equal((await client.get('/api/orders')).json.orders.length, 1);
  });

  test('admin sees orders with buyer and status', async () => {
    const list = (await admin.client.get('/api/admin/orders')).json.orders;
    assert.ok(list.length > 5);
    assert.ok(list.some((o) => o.status === 'paid'));
    assert.ok(list.every((o) => o.email && o.modName && o.reference));
  });

  test('sales are counted per mod in the admin list', async () => {
    const mod = await createMod(admin);
    const { client } = await signUp(srv);
    const order = (await startOrder(client, mod.id)).json;
    await client.get(`/api/orders/verify?reference=${order.reference}`);
    const found = (await admin.client.get('/api/admin/mods')).json.mods.find((m) => m.id === mod.id);
    assert.equal(found.sales, 1);
  });
});

describe('payments switched off', () => {
  let srv;
  before(async () => { srv = await startTestServer({ overrides: { paystack: { secretKey: '', publicKey: '' } } }); });
  after(async () => { await srv.close(); });

  test('buying is refused politely when Paystack is not configured', async () => {
    const admin = await makeAdmin(srv);
    const mod = await createMod(admin);
    const { client } = await signUp(srv);
    const res = await client.post('/api/orders', { modId: mod.id });
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'payments_unavailable');
    assert.equal((await new Client(srv.url).get('/api/config')).json.payments, false);
  });
});
