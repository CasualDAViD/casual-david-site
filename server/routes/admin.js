'use strict';

const express = require('express');
const auth = require('../auth');
const { bodyOf, cleanUrl, cleanEmail, priceToCents } = require('../validate');
const { newModId, SOCIAL_KEYS, SOCIAL_URL_KEYS } = require('../models');
const { createUploader, uploadedFiles, cleanupRequestFiles, storeImage, storeModFile } = require('../uploads');

module.exports = function adminRoutes({ db, config, models }) {
  const router = express.Router();
  router.use(auth.requireAdmin);

  const uploader = createUploader(config, models);
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  const q = {
    insert: db.prepare(`INSERT INTO mods (id, name, description, category, price_cents, icon_file, file_stored, file_name, file_size, created_at, updated_at)
                        VALUES (@id, @name, @description, @category, @price_cents, @icon_file, @file_stored, @file_name, @file_size, @now, @now)`),
    update: db.prepare(`UPDATE mods SET name=@name, description=@description, category=@category, price_cents=@price_cents,
                        icon_file=@icon_file, file_stored=@file_stored, file_name=@file_name, file_size=@file_size, updated_at=@now
                        WHERE id=@id AND deleted_at IS NULL`),
    softDelete: db.prepare('UPDATE mods SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'),
    addShot: db.prepare('INSERT INTO mod_screenshots (mod_id, file, position) VALUES (?, ?, ?)'),
    shots: db.prepare('SELECT * FROM mod_screenshots WHERE mod_id = ? ORDER BY position, id'),
    shotById: db.prepare('SELECT * FROM mod_screenshots WHERE id = ? AND mod_id = ?'),
    deleteShot: db.prepare('DELETE FROM mod_screenshots WHERE id = ?'),
    deleteShots: db.prepare('DELETE FROM mod_screenshots WHERE mod_id = ?'),
    orders: db.prepare(`
      SELECT o.id, o.reference, o.status, o.amount_kobo, o.created_at, o.paid_at, u.email, u.name AS user_name, m.name AS mod_name
      FROM orders o JOIN users u ON u.id = o.user_id JOIN mods m ON m.id = o.mod_id
      ORDER BY o.id DESC LIMIT 200`)
  };

  router.get('/mods', (req, res) => res.json({ mods: models.listMods({ admin: true }) }));

  // Validates the form, stores any uploaded files, and returns the new column
  // values. Anything it stores is tracked so it can be undone on failure.
  function buildFields(req, existing) {
    const body = bodyOf(req);
    const files = uploadedFiles(req);
    const stored = { images: [], privateFiles: [], replaced: [] };
    const rollback = () => {
      stored.images.forEach((f) => models.removeImage(f));
      stored.privateFiles.forEach((f) => models.removePrivateFile(f));
    };

    try {
      const name = existing && body.name === undefined ? existing.name : text(body.name);
      const description = existing && body.description === undefined ? existing.description : text(body.description);
      const category = existing && body.category === undefined ? existing.category : text(body.category) || 'Mod';
      const priceCents = existing && body.price === undefined ? existing.price_cents : priceToCents(body.price);

      if (!name || name.length > 120) throw new Error('Enter a name (up to 120 characters).');
      if (!description || description.length > 5000) throw new Error('Enter a description (up to 5000 characters).');
      if (!['Mod', 'Plugin'].includes(category)) throw new Error('Category must be Mod or Plugin.');
      if (!priceCents) throw new Error('Enter a price in USD greater than 0.');

      const fields = {
        name, description, category,
        price_cents: priceCents,
        icon_file: existing?.icon_file ?? null,
        file_stored: existing?.file_stored ?? null,
        file_name: existing?.file_name ?? null,
        file_size: existing?.file_size ?? null
      };

      if (files.icon) {
        const img = storeImage(files.icon, config, models);
        stored.images.push(img);
        if (existing?.icon_file) stored.replaced.push({ image: existing.icon_file });
        fields.icon_file = img;
      }
      if (files.file) {
        const f = storeModFile(files.file, models);
        stored.privateFiles.push(f.stored);
        if (existing?.file_stored) stored.replaced.push({ privateFile: existing.file_stored });
        fields.file_stored = f.stored;
        fields.file_name = files.file.originalname.slice(0, 200);
        fields.file_size = f.size;
      }

      const shots = files.screenshots.map((s) => {
        const img = storeImage(s, config, models);
        stored.images.push(img);
        return img;
      });
      return { fields, shots, stored, rollback, clearShots: body.clearScreenshots === 'true' || body.clearScreenshots === '1' };
    } catch (err) {
      rollback();
      throw err;
    }
  }

  function badRequest(res, req, err) {
    cleanupRequestFiles(req, models);
    return res.status(400).json({ error: 'invalid_mod', message: err.message });
  }

  router.post('/mods', uploader.parse, (req, res) => {
    let built;
    try { built = buildFields(req, null); } catch (err) { return badRequest(res, req, err); }
    cleanupRequestFiles(req, models); // anything left in tmp (already-moved files are gone)

    const id = newModId();
    const now = auth.nowSec();
    try {
      db.transaction(() => {
        q.insert.run({ id, now, ...built.fields });
        built.shots.forEach((file, i) => q.addShot.run(id, file, i));
      })();
    } catch (err) {
      built.rollback();
      throw err;
    }
    res.status(201).json({ mod: models.getMod(id, { admin: true }) });
  });

  router.put('/mods/:id', uploader.parse, (req, res) => {
    const existing = models.getModRow(req.params.id);
    if (!existing || existing.deleted_at) {
      cleanupRequestFiles(req, models);
      return res.status(404).json({ error: 'not_found', message: 'Mod not found.' });
    }
    let built;
    try { built = buildFields(req, existing); } catch (err) { return badRequest(res, req, err); }
    cleanupRequestFiles(req, models);

    const oldShots = built.clearShots ? q.shots.all(existing.id) : [];
    try {
      db.transaction(() => {
        q.update.run({ id: existing.id, now: auth.nowSec(), ...built.fields });
        if (built.clearShots) q.deleteShots.run(existing.id);
        const start = q.shots.all(existing.id).length;
        built.shots.forEach((file, i) => q.addShot.run(existing.id, file, start + i));
      })();
    } catch (err) {
      built.rollback();
      throw err;
    }

    // Only delete replaced files once the database change has succeeded.
    for (const r of built.stored.replaced) {
      if (r.image) models.removeImage(r.image);
      if (r.privateFile) models.removePrivateFile(r.privateFile);
    }
    oldShots.forEach((s) => models.removeImage(s.file));
    res.json({ mod: models.getMod(existing.id, { admin: true }) });
  });

  router.delete('/mods/:id/screenshots/:shotId', (req, res) => {
    const shot = q.shotById.get(Number(req.params.shotId), req.params.id);
    if (!shot) return res.status(404).json({ error: 'not_found', message: 'Screenshot not found.' });
    q.deleteShot.run(shot.id);
    models.removeImage(shot.file);
    res.json({ ok: true });
  });

  // Soft delete: the mod disappears from the shop, but people who already paid
  // keep their download and their purchase history.
  router.delete('/mods/:id', (req, res) => {
    const changed = q.softDelete.run(auth.nowSec(), req.params.id).changes;
    if (!changed) return res.status(404).json({ error: 'not_found', message: 'Mod not found.' });
    res.json({ ok: true });
  });

  router.get('/orders', (req, res) => {
    res.json({
      orders: q.orders.all().map((o) => ({
        id: o.id, reference: o.reference, status: o.status, amountKobo: o.amount_kobo,
        createdAt: o.created_at, paidAt: o.paid_at, email: o.email, userName: o.user_name, modName: o.mod_name
      }))
    });
  });

  router.put('/socials', (req, res) => {
    const body = bodyOf(req);
    const clean = {};
    for (const key of SOCIAL_KEYS) {
      const raw = body[key];
      if (raw === undefined || raw === null || text(raw) === '') continue;
      if (SOCIAL_URL_KEYS.has(key)) {
        const url = cleanUrl(raw);
        if (!url) return res.status(400).json({ error: 'invalid_url', message: `"${key}" must be a full link starting with http:// or https://.` });
        clean[key] = url;
      } else if (key === 'email') {
        const email = cleanEmail(raw);
        if (!email) return res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' });
        clean[key] = email;
      } else {
        clean[key] = text(raw).slice(0, 60);
      }
    }
    res.json(models.saveSocials(clean));
  });

  return router;
};
