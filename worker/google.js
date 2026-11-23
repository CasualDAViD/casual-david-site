// Shared helpers for the Cloudflare workers.
// Deploy with Wrangler so this import is bundled. Do not paste a single file
// into the dashboard on its own.

const PROJECT_ID = 'casualdavid-site';
const MAIN_ADMIN = 'okpeidavid7@gmail.com';

const ALLOWED_ORIGINS = new Set([
  'https://casualdavid.com.ng',
  'https://www.casualdavid.com.ng',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
]);

export const ADMIN_PERMS = ['delete-mod', 'edit-mod', 'donate', 'socials', 'analytics', 'purchases', 'users', 'mods', 'promo'];
export const NGN_PER_USD = 1550;
export const MIN_KOBO = 5000;

export function corsHeaders(request, methods) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://casualdavid.com.ng';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename, X-Kind',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  };
}

export function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

const buckets = new Map();

// Best-effort limit inside one worker isolate. Also turn on a Cloudflare
// rate-limiting rule for these routes.
export function hitLimit(ip, bucket, limit, windowMs) {
  const now = Date.now();
  if (buckets.size > 5000) buckets.clear();
  const id = bucket + '\n' + ip;
  let row = buckets.get(id);
  if (!row || row.reset < now) {
    row = { count: 0, reset: now + windowMs };
    buckets.set(id, row);
  }
  row.count += 1;
  return row.count > limit;
}

export function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : '';
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function b64urlBytes(bytes) {
  const u = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let bin = '';
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlStr(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  return atob(padded);
}

function b64urlToBuf(text) {
  const bin = b64urlDecode(text);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function b64ToBuf(text) {
  const clean = String(text).trim().replace(/\s+/g, '');
  if (!clean) return new Uint8Array();
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function pemToBuf(pem) {
  const clean = String(pem).replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  return b64ToBuf(clean);
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = decodeValue(value);
  return out;
}

function encodeValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  return { nullValue: null };
}

export async function readDoc(path, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) return { __error: res.status };
  const json = await res.json().catch(() => null);
  if (!json || !json.fields) return {};
  return decodeFields(json.fields);
}

export async function readPublicOrAdmin(env, path) {
  const open = await readDoc(path);
  if (open && !open.__error) return open;
  const token = await serviceAccountToken(env);
  if (!token) return open;
  return readDoc(path, token);
}

let jwksCache = { keys: null, exp: 0 };

async function firebaseKeys() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.exp > now) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const map = {};
  for (const key of json?.keys || []) map[key.kid] = key;
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: map, exp: now + Math.min(maxAge, 3600) * 1000 };
  return map;
}

// Checks a Firebase ID token (signature, project, issuer, expiry).
export async function verifyFirebaseIdToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 128) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.iat !== 'number' || payload.iat > now + 300) return null;
  const keys = await firebaseKeys();
  const jwk = keys?.[header.kid];
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBuf(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  return ok ? payload : null;
}

export async function assertAdmin(payload, anyOf, userToken) {
  const email = String(payload.email || '').toLowerCase();
  if (email === MAIN_ADMIN && payload.email_verified === true) return { role: 'main' };
  const doc = await readDoc(`admins/${encodeURIComponent(payload.sub)}`, userToken);
  if (!doc || doc.__error || doc.mustChangePassword === true) return null;
  const perms = Array.isArray(doc.permissions) ? doc.permissions.map(String) : [];
  if (anyOf && anyOf.length && !anyOf.some((perm) => perms.includes(perm))) return null;
  return { role: 'sub', permissions: perms };
}

let saCache = { token: '', exp: 0, key: '' };

export function loadServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return null;
  try {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function serviceAccountToken(env) {
  const account = loadServiceAccount(env);
  if (!account) return null;
  const now = Math.floor(Date.now() / 1000);
  if (saCache.token && saCache.key === account.client_email && saCache.exp > now + 60) return saCache.token;
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({
    iss: account.client_email,
    scope: [
      'https://www.googleapis.com/auth/datastore',
      'https://www.googleapis.com/auth/identitytoolkit',
      'https://www.googleapis.com/auth/firebase'
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  let key;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToBuf(account.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch {
    return null;
  }
  const unsigned = `${header}.${claim}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64urlBytes(sig)}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) return null;
  saCache = { token: json.access_token, exp: now + Number(json.expires_in || 3600), key: account.client_email };
  return json.access_token;
}

async function patchDoc(path, fields, token, updateMask) {
  const mask = updateMask ? `?${updateMask.map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join('&')}` : '';
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return res.ok;
}

function purchaseFields(purchase) {
  const fields = {};
  for (const [key, value] of Object.entries(purchase)) fields[key] = encodeValue(value);
  return fields;
}

export async function recordPurchase(env, purchase, userToken) {
  const sa = await serviceAccountToken(env);
  const path = `purchases/${encodeURIComponent(`${purchase.uid}_${purchase.modId}`)}`;
  const fields = purchaseFields(purchase);
  if (sa) return { ok: await patchDoc(path, fields, sa), haveServiceAccount: true };
  if (userToken) return { ok: await patchDoc(path, fields, userToken), haveServiceAccount: false };
  return { ok: false, haveServiceAccount: false };
}

export async function hasPurchase(uid, modId, userToken, env) {
  const path = `purchases/${encodeURIComponent(`${uid}_${modId}`)}`;
  const sa = env ? await serviceAccountToken(env) : null;
  const doc = await readDoc(path, sa || userToken);
  if (!doc || doc.__error) return false;
  return doc.uid === uid || doc.userId === uid;
}

export function priceUsdOf(mod) {
  if (!mod || mod.__error) return null;
  const versions = Array.isArray(mod.versions) ? mod.versions : [];
  const raw = versions.length ? versions[0].price : mod.price;
  const price = Number(raw);
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return null;
  return Math.round(price * 100) / 100;
}

export function quoteFromUsd(usd) {
  const amountNgn = Math.round(usd * NGN_PER_USD);
  const amountKobo = amountNgn * 100;
  if (!Number.isSafeInteger(amountKobo) || amountKobo < MIN_KOBO) return null;
  return { usd, amountNgn, amountKobo };
}

export function applyPromo(usd, promo, opts = {}) {
  if (!promo || promo.__error) return { error: 'missing' };
  if (!opts.ignoreLimits) {
    if (promo.unlisted === true) return { error: 'expired' };
    if (promo.expiresAt && Date.now() > Number(promo.expiresAt)) return { error: 'expired' };
    if (promo.maxUses && Number(promo.uses || 0) >= Number(promo.maxUses)) return { error: 'used' };
  }
  const percent = Number(promo.percent);
  if (!Number.isFinite(percent) || percent < 5 || percent > 100) return { error: 'invalid' };
  const discounted = Math.max(0, Math.round(usd * (100 - percent)) / 100);
  return { usd: discounted, percent };
}

export async function loadPromo(env, code) {
  const token = await serviceAccountToken(env);
  if (!token) return { error: 'unavailable' };
  const doc = await readDoc(`promos/${encodeURIComponent(code)}`, token);
  if (!doc) return { error: 'missing' };
  if (doc.__error) return { error: 'unavailable' };
  return doc;
}

export async function incrementPromo(env, code) {
  const token = await serviceAccountToken(env);
  if (!token) return;
  const path = `promos/${encodeURIComponent(code)}`;
  const doc = await readDoc(path, token);
  if (!doc || doc.__error) return;
  const uses = Number(doc.uses || 0) + 1;
  await patchDoc(path, { uses: { integerValue: String(uses) } }, token, ['uses']);
}

export async function createAuthUser(env, email, password) {
  const token = await serviceAccountToken(env);
  if (token) {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, emailVerified: false })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || '';
      if (msg.includes('EMAIL_EXISTS')) return { error: 'This email is already registered.' };
      return { error: 'Could not create that account.' };
    }
    return { uid: data.localId };
  }
  if (!env.FIREBASE_API_KEY) return { error: 'Account creation is not configured.' };
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || '';
    if (msg.includes('EMAIL_EXISTS')) return { error: 'This email is already registered.' };
    return { error: 'Could not create that account.' };
  }
  return { uid: data.localId };
}

export async function deleteAuthUser(env, uid) {
  const token = await serviceAccountToken(env);
  if (!token) return false;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid })
  });
  return res.ok;
}

export async function writeAdminDoc(uid, email, permissions, bearerToken) {
  const fields = {
    email: { stringValue: email },
    role: { stringValue: 'sub' },
    permissions: { arrayValue: { values: permissions.map((perm) => ({ stringValue: String(perm) })) } },
    mustChangePassword: { booleanValue: true },
    createdAt: { integerValue: String(Date.now()) }
  };
  return patchDoc(`admins/${encodeURIComponent(uid)}`, fields, bearerToken);
}

export async function deleteAdminDoc(uid, bearerToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/${encodeURIComponent(uid)}`;
  const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${bearerToken}` } });
  return res.ok || res.status === 404;
}

export async function sealKey(env, r2key) {
  const raw = b64ToBuf(env.FILE_SEAL_KEY || '');
  if (raw.length !== 32) return null;
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(r2key));
  return `${b64urlBytes(iv)}.${b64urlBytes(ct)}`;
}

export async function openSeal(env, seal) {
  if (typeof seal !== 'string' || !seal.includes('.')) return null;
  const raw = b64ToBuf(env.FILE_SEAL_KEY || '');
  if (raw.length !== 32) return null;
  const [ivPart, ctPart] = seal.split('.');
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBuf(ivPart) }, key, b64urlToBuf(ctPart));
    const text = new TextDecoder().decode(pt);
    return text.startsWith('mods/') && !text.includes('..') ? text : null;
  } catch {
    return null;
  }
}

export function safeDownloadName(name) {
  const base = String(name || 'download')
    .replace(/[\r\n"]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/^[._ -]+|[._ -]+$/g, '')
    .slice(0, 80);
  return base || 'download';
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
