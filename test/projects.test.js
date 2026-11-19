'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { startTestServer, Client, signUp, makeAdmin, createMod, modForm, PNG } = require('./helpers');
const { migrate, MIGRATIONS } = require('../server/db');
const { CLASSES, LICENSES, LINK_TYPES } = require('../server/catalog');

describe('project details (CurseForge-style fields)', () => {
  let srv, admin;
  before(async () => { srv = await startTestServer(); admin = await makeAdmin(srv); });
  after(async () => { await srv.close(); });

  const post = (opts) => admin.client.request('POST', '/api/admin/mods', {
    form: modForm({ icon: { data: PNG }, ...opts })
  });
  const put = (id, opts) => admin.client.request('PUT', `/api/admin/mods/${id}`, { form: modForm(opts) });

  test('a project stores every field and returns it', async () => {
    const markdown = '# Flashback Inventories\n\n- Records your **inventory**\n- <script>alert(1)</script> stays as typed text\n';
    const res = await post({
      name: 'Flashback Inventories',
      summary: 'Records your inventory and open GUIs in Flashback replays.',
      description: markdown,
      className: 'Mods', mainCategory: 'Utility & QoL',
      extraCategories: ['Performance', 'Map and Information'],
      unlisted: false, license: 'MIT License',
      links: [{ type: 'Website', url: 'casualdavid.com.ng' }, { type: 'YouTube', url: 'https://www.youtube.com/@CasualDAViD' }],
      price: '3.50', file: { data: Buffer.from('jar'), name: 'fi.jar' }
    });
    assert.equal(res.status, 201, res.text);
    const m = res.json.mod;
    assert.equal(m.class, 'Mods');
    assert.equal(m.mainCategory, 'Utility & QoL');
    assert.deepEqual(m.categories, ['Performance', 'Map and Information']);
    assert.deepEqual(m.license, { name: 'MIT License', url: 'https://opensource.org/license/mit' });
    assert.equal(m.description, markdown.trim(), 'markdown is stored as typed (line breaks normalized); it is made safe when displayed');
    assert.equal(m.unlisted, false);
    assert.deepEqual(m.links, [
      { type: 'Website', url: 'https://casualdavid.com.ng/' },
      { type: 'YouTube', url: 'https://www.youtube.com/@CasualDAViD' }
    ]);
  });

  test('license defaults to All Rights Reserved and the rest default sensibly', async () => {
    const m = (await post({})).json.mod;
    assert.equal(m.license.name, 'All Rights Reserved');
    assert.equal(m.license.url, null);
    assert.deepEqual(m.categories, []);
    assert.deepEqual(m.links, []);
    assert.equal(m.unlisted, false);
  });

  test('required fields and limits are enforced with clear messages', async () => {
    const cases = [
      [{ name: '' }, /project name/i],
      [{ name: 'x'.repeat(129) }, /project name/i],
      [{ summary: '' }, /summary/i],
      [{ summary: 'x'.repeat(257) }, /summary/i],
      [{ description: '' }, /description/i],
      [{ description: 'x'.repeat(20001) }, /description/i],
      [{ className: 'Hacks' }, /class/i],
      [{ className: 'Plugins', mainCategory: 'Utility & QoL' }, /main category/i],
      [{ mainCategory: 'Nonsense' }, /main category/i],
      [{ extraCategories: ['Nope'] }, /not a category/i],
      [{ extraCategories: ['Magic', 'Food', 'Mobs', 'Redstone', 'Storage', 'Cosmetic'] }, /up to 5/i],
      [{ license: 'My Own License' }, /license/i],
      [{ price: '0' }, /price/i]
    ];
    for (const [opts, pattern] of cases) {
      const res = await post(opts);
      assert.equal(res.status, 400, `${JSON.stringify(opts).slice(0, 60)} should be rejected`);
      assert.match(res.json.message, pattern);
    }
  });

  test('a logo is required when creating, but not when editing', async () => {
    const noLogo = await admin.client.request('POST', '/api/admin/mods', { form: modForm({}) });
    assert.equal(noLogo.status, 400);
    assert.match(noLogo.json.message, /logo/i);

    const m = (await post({ name: 'Has Logo' })).json.mod;
    const edited = await put(m.id, { name: 'Renamed' });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.mod.icon, m.icon, 'logo is kept');
  });

  test('categories that repeat the main category are dropped, duplicates collapse', async () => {
    const m = (await post({ mainCategory: 'Magic', extraCategories: ['Magic', 'Food', 'Food'] })).json.mod;
    assert.deepEqual(m.categories, ['Food']);
  });

  test('social links: only real web addresses, known types, no duplicates, blanks ignored', async () => {
    for (const links of [
      [{ type: 'Website', url: 'javascript:alert(1)' }],
      [{ type: 'Website', url: 'data:text/html,x' }],
      [{ type: 'Website', url: 'not a url at all' }],
      [{ type: 'MySpace', url: 'https://example.com' }],
      [{ type: 'Discord', url: 'https://discord.gg/a' }, { type: 'Discord', url: 'https://discord.gg/b' }]
    ]) {
      const res = await post({ links });
      assert.equal(res.status, 400, `${JSON.stringify(links)} must be rejected`);
    }
    const ok = await post({ links: [{ type: 'Website', url: '' }, { type: 'Ko-fi', url: 'https://ko-fi.com/casualdavid' }] });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.json.mod.links, [{ type: 'Ko-fi', url: 'https://ko-fi.com/casualdavid' }]);
    assert.equal((await post({ links: Array.from({ length: 9 }, (_, i) => ({ type: LINK_TYPES[i], url: 'https://example.com/' + i })) })).status, 400);
  });

  test('unlisted projects are hidden from the shop but open by direct link, and can still be bought', async () => {
    const m = (await post({ name: 'Secret Pack', unlisted: true, file: { data: Buffer.from('s') } })).json.mod;
    assert.equal(m.unlisted, true);

    const visitor = new Client(srv.url);
    assert.ok(!(await visitor.get('/api/mods')).json.mods.some((x) => x.id === m.id), 'not in the public list');
    assert.equal((await visitor.get(`/api/mods/${m.id}`)).status, 200, 'direct link works');
    assert.ok((await admin.client.get('/api/admin/mods')).json.mods.find((x) => x.id === m.id).unlisted, 'admin still sees it');

    const { client } = await signUp(srv);
    assert.equal((await client.post('/api/orders', { modId: m.id })).status, 201);

    const flipped = await put(m.id, { unlisted: false });
    assert.equal(flipped.json.mod.unlisted, false);
    assert.ok((await visitor.get('/api/mods')).json.mods.some((x) => x.id === m.id));
  });

  test('the shop list is light (no long description); the detail page has everything', async () => {
    const m = (await post({ name: 'Detail Test', description: 'LONG TEXT '.repeat(50) })).json.mod;
    const listed = (await new Client(srv.url).get('/api/mods')).json.mods.find((x) => x.id === m.id);
    assert.equal(listed.description, undefined);
    assert.ok(listed.summary && listed.mainCategory && listed.class);
    const detail = (await new Client(srv.url).get(`/api/mods/${m.id}`)).json.mod;
    assert.ok(detail.description.startsWith('LONG TEXT'));
  });

  test('editing only some fields keeps the rest; changing class with a stale category is refused', async () => {
    const m = (await post({
      name: 'Keeper', extraCategories: ['Magic'], links: [{ type: 'Discord', url: 'https://discord.gg/keep' }], license: 'GNU GPLv3'
    })).json.mod;

    const fd = new FormData();
    fd.set('summary', 'Only the summary changed.');
    const res = await admin.client.request('PUT', `/api/admin/mods/${m.id}`, { form: fd });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.mod.summary, 'Only the summary changed.');
    assert.equal(res.json.mod.name, 'Keeper');
    assert.deepEqual(res.json.mod.categories, ['Magic']);
    assert.equal(res.json.mod.links[0].url, 'https://discord.gg/keep');
    assert.equal(res.json.mod.license.name, 'GNU GPLv3');

    const stale = new FormData();
    stale.set('class', 'Plugins'); // main category "Utility & QoL" is not a Plugins category
    assert.equal((await admin.client.request('PUT', `/api/admin/mods/${m.id}`, { form: stale })).status, 400);
  });

  test('screenshots marked for removal are deleted only when the project is saved', async () => {
    const a = (await post({ name: 'Shots A', screenshots: [{ data: PNG }, { data: PNG }, { data: PNG }] })).json.mod;
    const b = (await post({ name: 'Shots B', screenshots: [{ data: PNG }] })).json.mod;
    assert.equal(a.screenshots.length, 3);

    const [first, second] = a.screenshotIds;
    const foreignId = b.screenshotIds[0];
    const res = await put(a.id, { extra: { removeScreenshots: JSON.stringify([first, foreignId, 'junk']) } });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.json.mod.screenshotIds, a.screenshotIds.filter((id) => id !== first));
    assert.ok(res.json.mod.screenshotIds.includes(second));

    const other = (await admin.client.get('/api/admin/mods')).json.mods.find((x) => x.id === b.id);
    assert.equal(other.screenshots.length, 1, "another project's screenshot is never touched");

    const bad = await put(a.id, { extra: { removeScreenshots: 'not-json' } });
    assert.equal(bad.status, 400);
  });

  test('only admins can use any of this', async () => {
    const { client } = await signUp(srv);
    const res = await client.request('POST', '/api/admin/mods', { form: modForm({ icon: { data: PNG } }) });
    assert.equal(res.status, 403);
  });

  test('the config the admin page reads matches the server rules', async () => {
    const cfg = (await new Client(srv.url).get('/api/config')).json;
    assert.deepEqual(Object.keys(cfg.catalog.classes), Object.keys(CLASSES));
    assert.deepEqual(cfg.catalog.licenses.map((l) => l.name), LICENSES.map((l) => l.name));
    assert.equal(cfg.catalog.limits.summary, 256);
  });
});

describe('catalog sanity', () => {
  test('no duplicate categories within a class, no duplicate licenses, https license links', () => {
    for (const [name, cats] of Object.entries(CLASSES)) {
      assert.equal(new Set(cats).size, cats.length, `${name} has duplicates`);
    }
    assert.equal(new Set(LICENSES.map((l) => l.name)).size, LICENSES.length);
    for (const l of LICENSES) assert.ok(l.url === null || l.url.startsWith('https://'));
    assert.equal(LICENSES[0].name, 'All Rights Reserved');
  });
});

describe('upgrading an existing database', () => {
  test('projects saved before this update keep working and get sensible values', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(MIGRATIONS[0]);
    db.pragma('user_version = 1');
    const ins = db.prepare(`INSERT INTO mods (id, name, description, category, price_cents, created_at, updated_at)
                            VALUES (?, ?, ?, ?, 500, 1, 1)`);
    ins.run('mod-a', 'Old Mod', 'First line.\r\nSecond line.', 'Mod');
    ins.run('mod-b', 'Old Plugin', 'Plugin text', 'Plugin');

    migrate(db);

    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    const a = db.prepare('SELECT * FROM mods WHERE id = ?').get('mod-a');
    const b = db.prepare('SELECT * FROM mods WHERE id = ?').get('mod-b');
    assert.equal(a.class_name, 'Mods');
    assert.equal(b.class_name, 'Plugins');
    assert.equal(a.summary, 'First line.  Second line.');
    assert.equal(a.license, 'All Rights Reserved');
    assert.equal(a.unlisted, 0);
    assert.equal(a.links, '[]');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM mods').get().n, 2, 'no rows lost');

    // Running it again changes nothing.
    migrate(db);
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
  });
});
