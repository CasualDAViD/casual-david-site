'use strict';

const express = require('express');
const auth = require('../auth');
const { bodyOf, cleanUrl, cleanEmail, priceToCents } = require('../validate');
const { newModId, SOCIAL_KEYS, SOCIAL_URL_KEYS } = require('../models');
const { createUploader, uploadedFiles, cleanupRequestFiles, storeImage, storeModFile } = require('../uploads');
const { CLASSES, LICENSES, LINK_TYPES, LIMITS, DEFAULT_LICENSE, legacyCategory } = require('../catalog');

module.exports = function adminRoutes({ db, config, models }) {
  const router = express.Router();
  router.use(auth.requireAdmin);

  const uploader = createUploader(config, models);
  const text = (v) => (typeof v === 'string' ? v.trim() : '');

  const q = {
    insert: db.prepare(`INSERT INTO mods
      (id, name, summary, description, category, class_name, main_category, extra_categories, unlisted, license, links,
       price_cents, icon_file, file_stored, file_name, file_size, created_at, updated_at)
      VALUES (@id, @name, @summary, @description, @category, @class_name, @main_category, @extra_categories, @unlisted, @license, @links,
       @price_cents, @icon_file, @file_stored, @file_name, @file_size, @now, @now)`),
    update: db.prepare(`UPDATE mods SET name=@name, summary=@summary, description=@description, category=@category,
      class_name=@class_name, main_category=@main_category, extra_categories=@extra_categories, unlisted=@unlisted,
      license=@license, links=@links, price_cents=@price_cents, icon_file=@icon_file, file_stored=@file_stored,
      file_name=@file_name, file_size=@file_size, updated_at=@now
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

  // ---- field parsing ---------------------------------------------------------

  // Form fields arrive as strings, so lists are sent as JSON text.
  function jsonList(value, label) {
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
    throw new Error(`${label} could not be read.`);
  }

  const flag = (v) => v === true || v === 'true' || v === '1' || v === 1;

  // "casualdavid.com.ng" is fine: https:// is added when no scheme is typed.
  function cleanLinkUrl(raw) {
    const s = text(raw);
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
    return cleanUrl(withScheme);
  }

  function parseLinks(value) {
    const seen = new Set();
    const links = [];
    for (const item of jsonList(value, 'Social links')) {
      const type = text(item?.type);
      const raw = text(item?.url);
      if (!raw) continue; // blank row, ignore
      if (!LINK_TYPES.includes(type)) throw new Error(`"${type || 'Link'}" is not a supported link type.`);
      if (seen.has(type)) throw new Error(`You added ${type} twice.`);
      const url = cleanLinkUrl(raw);
      if (!url) throw new Error(`The ${type} link is not a valid web address.`);
      seen.add(type);
      links.push({ type, url });
    }
    if (links.length > LIMITS.links) throw new Error(`You can add up to ${LIMITS.links} social links.`);
    return links;
  }

  function parseExtraCategories(value, className, mainCategory) {
    const allowed = CLASSES[className];
    const out = [];
    for (const c of jsonList(value, 'Additional categories')) {
      if (!allowed.includes(c)) throw new Error(`"${c}" is not a category for ${className}.`);
      if (c === mainCategory || out.includes(c)) continue;
      out.push(c);
    }
    if (out.length > LIMITS.extraCategories) throw new Error(`Choose up to ${LIMITS.extraCategories} additional categories.`);
    return out;
  }

  // Validates the form, stores any uploaded files, and returns the column values.
  // Anything stored is tracked so it can be undone if something later fails.
  function buildFields(req, existing) {
    const body = bodyOf(req);
    const files = uploadedFiles(req);
    const stored = { images: [], privateFiles: [], replaced: [] };
    const rollback = () => {
      stored.images.forEach((f) => models.removeImage(f));
      stored.privateFiles.forEach((f) => models.removePrivateFile(f));
    };
    const has = (key) => body[key] !== undefined;

    try {
      const name = has('name') ? text(body.name) : existing?.name;
      const summary = has('summary') ? text(body.summary).replace(/\s+/g, ' ') : existing?.summary;
      // Forms send line breaks as \r\n; store plain \n so the text is the same everywhere.
      const description = has('description') ? text(body.description).replace(/\r\n?/g, '\n') : existing?.description;
      const className = has('class') ? text(body.class) : existing?.class_name;
      const mainCategory = has('mainCategory') ? text(body.mainCategory) : existing?.main_category;
      const priceCents = has('price') ? priceToCents(body.price) : existing?.price_cents;
      const license = has('license') ? text(body.license) : (existing?.license ?? DEFAULT_LICENSE);

      if (!name || name.length > LIMITS.name) throw new Error(`Enter a project name (up to ${LIMITS.name} characters).`);
      if (!summary || summary.length > LIMITS.summary) throw new Error(`Enter a summary (up to ${LIMITS.summary} characters).`);
      if (!description || description.length > LIMITS.description) throw new Error(`Enter a description (up to ${LIMITS.description} characters).`);
      if (!className || !Object.hasOwn(CLASSES, className)) throw new Error('Choose a class.');
      if (!CLASSES[className].includes(mainCategory)) throw new Error(`Choose a main category that fits ${className}.`);
      if (!priceCents) throw new Error('Enter a price in USD greater than 0.');
      if (!LICENSES.some((l) => l.name === license)) throw new Error('Choose a license from the list.');

      const extraCategories = has('extraCategories')
        ? parseExtraCategories(body.extraCategories, className, mainCategory)
        : (existing ? parseExtraCategories(existing.extra_categories, className, mainCategory) : []);
      const links = has('links') ? parseLinks(body.links) : (existing ? JSON.parse(existing.links) : []);
      const unlisted = has('unlisted') ? flag(body.unlisted) : Boolean(existing?.unlisted);

      if (!existing && !files.icon) throw new Error('Upload a logo for the project.');

      const fields = {
        name, summary, description,
        category: legacyCategory(className),
        class_name: className,
        main_category: mainCategory,
        extra_categories: JSON.stringify(extraCategories),
        unlisted: unlisted ? 1 : 0,
        license,
        links: JSON.stringify(links),
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

      // Screenshots to remove are only applied once the save succeeds.
      let removeShotIds = [];
      if (existing && has('removeScreenshots')) {
        removeShotIds = jsonList(body.removeScreenshots, 'The screenshot list').map(Number).filter(Number.isInteger);
      }
      return {
        fields, shots, stored, rollback, removeShotIds,
        clearShots: body.clearScreenshots === 'true' || body.clearScreenshots === '1'
      };
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
    const removed = [];
    try {
      db.transaction(() => {
        q.update.run({ id: existing.id, now: auth.nowSec(), ...built.fields });
        if (built.clearShots) q.deleteShots.run(existing.id);
        for (const shotId of built.removeShotIds) {
          const shot = q.shotById.get(shotId, existing.id);
          if (shot) { q.deleteShot.run(shot.id); removed.push(shot); }
        }
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
    removed.forEach((s) => models.removeImage(s.file));
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
