// Cloudflare Worker — Paystack checkout.
// The price is read from Firestore. The browser cannot choose the amount.
//
// Secrets (wrangler secret put, or the dashboard):
//   PAYSTACK_SECRET_KEY          sk_live_... or sk_test_...
//   FIREBASE_SERVICE_ACCOUNT     full service-account JSON, one line
// Optional:
//   RATE_NGN                     naira per 1 USD (default 1550)
//
// Webhook URL: https://<this-worker>/webhook
// Deploy: npx wrangler deploy --config worker/paystack.toml

import {
  NGN_PER_USD,   applyPromo, bearer, clientIp, corsHeaders, hasPurchase, hitLimit, incrementPromo,
  json, loadPromo, priceUsdOf, readPublicOrAdmin, recordPurchase, safeEqual,
  verifyFirebaseIdToken
} from './google.js';

function allowedCallback(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const local = host === 'localhost' || host === '127.0.0.1';
    if (url.protocol === 'https:') {
      if (host !== 'casualdavid.com.ng' && host !== 'www.casualdavid.com.ng') return false;
    } else if (!(url.protocol === 'http:' && local)) {
      return false;
    }
    return url.pathname === '/order-complete.html';
  } catch {
    return false;
  }
}

function paystackHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'paystack.com' || url.hostname.endsWith('.paystack.com'));
  } catch {
    return false;
  }
}

async function loadQuote(env, modId, promoCode, opts = {}) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(modId)) return { error: 'That mod could not be found.', status: 404 };
  const mod = await readPublicOrAdmin(env, `mods/${encodeURIComponent(modId)}`);
  if (!mod || mod.__error) return { error: 'That mod could not be found.', status: 404 };
  const base = priceUsdOf(mod);
  if (base == null) return { error: 'This mod is not available to buy yet.', status: 409 };
  const versions = Array.isArray(mod.versions) ? mod.versions : [];
  const hasFile = Boolean(mod.fileSeal || mod.fileUrl || versions[0]?.fileSeal || versions[0]?.fileUrl);
  if (!hasFile) return { error: 'This mod is not available to buy yet.', status: 409 };

  let usd = base;
  let percent = 0;
  let code = '';
  if (promoCode) {
    if (!/^[A-Z0-9]{3,20}$/.test(promoCode)) return { error: 'Code not found.', status: 400 };
    const promo = await loadPromo(env, promoCode);
    if (promo.error === 'unavailable') {
      return { error: 'Promo codes cannot be checked right now. You can still pay the full price.', status: 503 };
    }
    if (promo.error === 'missing') return { error: 'Code not found.', status: 400 };
    const applied = applyPromo(base, promo, opts);
    if (applied.error === 'expired') return { error: 'Code expired.', status: 400 };
    if (applied.error === 'used') return { error: 'Code used up.', status: 400 };
    if (applied.error) return { error: 'Code not found.', status: 400 };
    usd = applied.usd;
    percent = applied.percent;
    code = promoCode;
  }

  const rate = Number(env.RATE_NGN || NGN_PER_USD);
  const amountNgn = Math.round(usd * (Number.isFinite(rate) && rate > 0 ? rate : NGN_PER_USD));
  const amountKobo = amountNgn * 100;
  if (!Number.isSafeInteger(amountKobo) || amountKobo < 5000) {
    return { error: 'That price is below the minimum Paystack can charge.', status: 400 };
  }
  return {
    mod,
    modId,
    modName: String(mod.name || 'Mod').slice(0, 120),
    usd,
    percent,
    code,
    amountNgn,
    amountKobo
  };
}

async function paystack(env, method, path, body) {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok && data?.status === true, data };
}

async function settle(env, tx, userToken) {
  let meta = tx?.metadata || {};
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = {}; }
  }
  if (!meta || typeof meta !== 'object') meta = {};
  const modId = String(meta.modId || '');
  const uid = String(meta.userId || '');
  const promo = String(meta.promo || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(modId) || !uid) return { ok: false, reason: 'metadata' };
  // Ignore promo use-counts here: the code was checked when checkout started,
  // and a second confirmation must still unlock a payment that already went through.
  const quote = await loadQuote(env, modId, promo, { ignoreLimits: true });
  if (quote.error || quote.amountKobo !== Number(tx.amount) || String(tx.currency || '').toUpperCase() !== 'NGN') {
    return { ok: false, reason: 'amount' };
  }
  const already = await hasPurchase(uid, modId, '', env);
  const purchase = {
    uid,
    userId: uid,
    email: String(meta.email || '').slice(0, 254),
    displayName: String(meta.displayName || '').slice(0, 80),
    modId,
    modName: quote.modName,
    reference: String(tx.reference || ''),
    amount: quote.usd,
    test: String(env.PAYSTACK_SECRET_KEY || '').startsWith('sk_test_'),
    paidAt: Date.now(),
    purchasedAt: Date.now()
  };
  const recorded = await recordPurchase(env, purchase, userToken && userToken.sub === uid ? userToken.token : '');
  if (recorded.ok && quote.code && !already) await incrementPromo(env, quote.code);
  return { ok: true, quote, recorded: recorded.ok, retry: recorded.haveServiceAccount && !recorded.ok };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, 'POST, GET, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!env.PAYSTACK_SECRET_KEY) return json({ error: 'Payments are not set up yet.' }, 503, cors);

    const ip = clientIp(request);

    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/quote')) {
      if (hitLimit(ip, 'paystack-init', 40, 15 * 60 * 1000)) {
        return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429, cors);
      }
      const token = bearer(request);
      const user = await verifyFirebaseIdToken(token);
      if (!user || !user.email) return json({ error: 'Please sign in first.' }, 401, cors);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'The request could not be read.' }, 400, cors); }
      const modId = typeof body.modId === 'string' ? body.modId : '';
      const promoCode = typeof body.promoCode === 'string' ? body.promoCode.trim().toUpperCase() : '';
      const quote = await loadQuote(env, modId, promoCode);
      if (quote.error) return json({ error: quote.error }, quote.status, cors);

      if (url.pathname === '/quote') {
        return json({
          amountUsd: quote.usd,
          amountNgn: quote.amountNgn,
          percent: quote.percent,
          modName: quote.modName
        }, 200, cors);
      }

      const callback = typeof body.callbackUrl === 'string' && allowedCallback(body.callbackUrl)
        ? body.callbackUrl
        : 'https://casualdavid.com.ng/order-complete.html';
      const reference = `cd_${crypto.randomUUID().replace(/-/g, '')}`;
      const init = await paystack(env, 'POST', '/transaction/initialize', {
        email: user.email,
        amount: quote.amountKobo,
        currency: 'NGN',
        reference,
        callback_url: callback,
        metadata: {
          modId: quote.modId,
          modName: quote.modName,
          userId: user.sub,
          email: user.email,
          displayName: String(user.name || '').slice(0, 80),
          promo: quote.code,
          amountUsd: quote.usd
        }
      });
      const authorizationUrl = init.data?.data?.authorization_url;
      if (!init.ok || !paystackHost(authorizationUrl)) {
        console.error('[paystack] initialize failed');
        return json({ error: 'Could not start the payment. Please try again.' }, 502, cors);
      }
      return json({
        authorization_url: authorizationUrl,
        reference: init.data.data.reference,
        amountNgn: quote.amountNgn
      }, 200, cors);
    }

    if (request.method === 'GET' && url.pathname === '/verify') {
      if (hitLimit(ip, 'paystack-verify', 30, 15 * 60 * 1000)) {
        return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429, cors);
      }
      const reference = url.searchParams.get('reference') || '';
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(reference)) return json({ success: false }, 400, cors);
      const verified = await paystack(env, 'GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      const tx = verified.data?.data;
      if (!verified.ok || tx?.status !== 'success') return json({ success: false }, 200, cors);
      const user = await verifyFirebaseIdToken(bearer(request));
      const settled = await settle(env, tx, user ? { sub: user.sub, token: bearer(request) } : null);
      if (!settled.ok) return json({ success: false }, 200, cors);
      return json({
        success: true,
        modId: settled.quote.modId,
        modName: settled.quote.modName,
        reference: tx.reference,
        recorded: settled.recorded,
        test: String(env.PAYSTACK_SECRET_KEY).startsWith('sk_test_'),
        metadata: { modId: settled.quote.modId, modName: settled.quote.modName }
      }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (hitLimit(ip, 'paystack-hook', 120, 15 * 60 * 1000)) return json({ error: 'rate_limited' }, 429, cors);
      const raw = await request.text();
      if (raw.length > 256 * 1024) return json({ error: 'bad_body' }, 413, cors);
      const signature = request.headers.get('x-paystack-signature') || '';
      const expected = await hmac(env.PAYSTACK_SECRET_KEY, raw);
      if (!safeEqual(expected, signature)) return json({ error: 'bad_signature' }, 401, cors);
      let event;
      try { event = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400, cors); }
      if (event?.event === 'charge.success' && event.data?.reference) {
        const verified = await paystack(env, 'GET', `/transaction/verify/${encodeURIComponent(String(event.data.reference))}`);
        const tx = verified.data?.data;
        if (verified.ok && tx?.status === 'success') {
          const settled = await settle(env, tx, null);
          if (settled.retry) return json({ error: 'verify_failed' }, 500, cors);
        }
      }
      return json({ ok: true }, 200, cors);
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};

async function hmac(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
