'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../auth');
const { bodyOf, safeFileName } = require('../validate');
const { newOrderReference } = require('../models');
const { receiptEmail } = require('../mailer');
const { PaystackError } = require('../paystack');

function limiter(bucket, options = {}) {
  return rateLimit({
    windowMs: bucket.windowMs,
    limit: bucket.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' },
    ...options
  });
}

module.exports = function shopRoutes({ db, config, models, paystack, mailer }) {
  const router = express.Router();
  const payLimit = limiter(config.paymentRateLimit || config.rateLimit);
  const hookLimit = limiter(config.webhookRateLimit || config.rateLimit);

  // ---- public catalogue -------------------------------------------------

  router.get('/config', (req, res) => {
    res.json({
      rates: config.rates,
      payments: config.paystack.enabled,
      passwordReset: mailer.enabled,
      oauth: { google: config.oauth.google.enabled, discord: config.oauth.discord.enabled }
    });
  });

  router.get('/socials', (req, res) => res.json(models.getSocials()));

  router.get('/mods', (req, res) => res.json({ mods: models.listMods() }));

  router.get('/mods/:id', (req, res) => {
    const mod = models.getMod(req.params.id);
    if (!mod) return res.status(404).json({ error: 'not_found', message: 'Mod not found.' });
    res.json({ mod });
  });

  // ---- orders -----------------------------------------------------------

  const q = {
    order: db.prepare('SELECT * FROM orders WHERE reference = ?'),
    owns: db.prepare("SELECT 1 FROM orders WHERE user_id = ? AND mod_id = ? AND status = 'paid' LIMIT 1"),
    insert: db.prepare(`INSERT INTO orders (reference, user_id, mod_id, amount_kobo, currency, status, created_at)
                        VALUES (?, ?, ?, ?, 'NGN', 'pending', ?)`),
    markPaid: db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status != 'paid'"),
    markFailed: db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'"),
    mine: db.prepare(`
      SELECT o.id, o.reference, o.amount_kobo, o.currency, o.paid_at, m.id AS mod_id, m.name, m.category,
             m.icon_file, m.file_stored, m.file_name
      FROM orders o JOIN mods m ON m.id = o.mod_id
      WHERE o.user_id = ? AND o.status = 'paid'
      ORDER BY o.paid_at DESC, o.id DESC`),
    user: db.prepare('SELECT * FROM users WHERE id = ?')
  };

  // Settles an order from a Paystack transaction. Safe to call any number of
  // times: only the first call that flips it to "paid" sends the receipt.
  function settleOrder(order, tx) {
    if (!tx || tx.reference !== order.reference) return order.status;

    if (tx.status === 'success') {
      // Never trust the browser or even the status alone: the money must match.
      if (tx.amount !== order.amount_kobo || String(tx.currency).toUpperCase() !== order.currency) {
        console.error(`[orders] amount mismatch on ${order.reference}: expected ${order.amount_kobo} ${order.currency}, got ${tx.amount} ${tx.currency}`);
        return order.status;
      }
      const changed = q.markPaid.run(auth.nowSec(), order.id).changes === 1;
      if (changed) sendReceipt(order);
      return 'paid';
    }
    if (tx.status === 'failed') {
      q.markFailed.run(order.id);
      return order.status === 'pending' ? 'failed' : order.status;
    }
    return order.status; // abandoned / ongoing: leave pending
  }

  function sendReceipt(order) {
    if (!mailer.enabled) return;
    const user = q.user.get(order.user_id);
    const mod = models.getModRow(order.mod_id);
    if (!user || !mod) return;
    mailer.send({
      to: user.email,
      ...receiptEmail({
        name: user.name,
        modName: mod.name,
        amountKobo: order.amount_kobo,
        reference: order.reference,
        historyUrl: `${config.siteUrl}/history.html`
      })
    }).catch((err) => console.error('[mail] receipt failed:', err.message));
  }

  router.post('/orders', auth.requireAuth, payLimit, async (req, res) => {
    if (!config.paystack.enabled) {
      return res.status(503).json({ error: 'payments_unavailable', message: 'Payments are not set up yet. Please check back soon.' });
    }
    const mod = models.getMod(bodyOf(req).modId);
    if (!mod) return res.status(404).json({ error: 'not_found', message: 'Mod not found.' });
    if (!mod.available) return res.status(409).json({ error: 'not_available', message: 'This mod is not available to buy yet.' });
    if (q.owns.get(req.user.id, mod.id)) {
      return res.status(409).json({ error: 'already_owned', message: 'You already own this. Download it from your purchase history.' });
    }

    // Prices are kept in USD cents; Paystack charges NGN kobo (1 NGN = 100 kobo).
    const row = models.getModRow(mod.id);
    const amountKobo = Math.round(row.price_cents * config.rates.NGN);
    const reference = newOrderReference();
    const orderId = q.insert.run(reference, req.user.id, mod.id, amountKobo, auth.nowSec()).lastInsertRowid;

    try {
      const init = await paystack.initialize({
        email: req.user.email,
        amountKobo,
        reference,
        callbackUrl: `${config.siteUrl}/order-complete.html`,
        metadata: { mod_id: mod.id, mod_name: mod.name, user_id: req.user.id }
      });
      res.status(201).json({ reference, authorizationUrl: init.authorization_url });
    } catch (err) {
      q.markFailed.run(orderId);
      console.error('[paystack] initialize failed:', err.message);
      const status = err instanceof PaystackError ? 502 : 500;
      res.status(status).json({ error: 'payment_start_failed', message: 'Could not start the payment. Please try again.' });
    }
  });

  // The buyer lands here after Paystack. We ask Paystack what really happened.
  router.get('/orders/verify', auth.requireAuth, payLimit, async (req, res) => {
    const reference = typeof req.query.reference === 'string' ? req.query.reference : '';
    const order = reference ? q.order.get(reference) : null;
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: 'not_found', message: 'We could not find that order.' });
    }

    let status = order.status;
    if (status === 'pending') {
      try {
        status = settleOrder(order, await paystack.verify(reference));
      } catch (err) {
        console.error('[paystack] verify failed:', err.message);
      }
    }
    const mod = models.getModRow(order.mod_id);
    res.json({ status, modId: order.mod_id, modName: mod?.name || 'your item' });
  });

  router.get('/orders', auth.requireAuth, (req, res) => {
    const orders = q.mine.all(req.user.id).map((o) => ({
      id: o.id,
      reference: o.reference,
      amountKobo: o.amount_kobo,
      currency: o.currency,
      paidAt: o.paid_at,
      mod: {
        id: o.mod_id,
        name: o.name,
        category: o.category,
        icon: o.icon_file ? `/uploads/${o.icon_file}` : null,
        downloadable: Boolean(o.file_stored),
        fileName: o.file_name
      }
    }));
    res.json({ orders });
  });

  // Paystack calls this itself, so payments still count if the buyer closes the tab.
  // The body arrives raw (see index.js) because the signature covers exact bytes.
  router.post('/paystack/webhook', hookLimit, async (req, res) => {
    if (!paystack.validSignature(req.body, req.get('x-paystack-signature'))) {
      return res.status(401).json({ error: 'bad_signature' });
    }
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'bad_json' }); }

    if (event?.event === 'charge.success' && event.data?.reference) {
      const order = q.order.get(String(event.data.reference));
      if (order) {
        try {
          // Confirm with Paystack instead of trusting the webhook body.
          settleOrder(order, await paystack.verify(order.reference));
        } catch (err) {
          console.error('[paystack] webhook verify failed:', err.message);
          return res.status(500).json({ error: 'verify_failed' }); // Paystack will retry
        }
      }
    }
    res.json({ ok: true });
  });

  // ---- downloads --------------------------------------------------------

  router.get('/downloads/:modId', auth.requireAuth, (req, res) => {
    const row = models.getModRow(req.params.modId);
    const allowed = row && (req.user.role === 'admin' || q.owns.get(req.user.id, row.id));
    if (!allowed) return res.status(403).json({ error: 'forbidden', message: 'Buy this mod to download it.' });
    if (!row.file_stored) return res.status(404).json({ error: 'no_file', message: 'The file for this item is not available yet.' });

    const ext = require('node:path').extname(row.file_stored);
    const name = safeFileName(row.file_name, row.name, ext);
    res.set('Cache-Control', 'private, no-store');
    res.download(require('node:path').join(models.filesDir, row.file_stored), name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'no_file', message: 'The file could not be found.' });
    });
  });

  return router;
};
