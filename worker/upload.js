// Cloudflare Worker — admin uploads and buyer downloads (R2).
//
// Secrets:
//   PUBLIC_URL                 public base URL for images only, no trailing path
//   FILE_SEAL_KEY              32 bytes, standard base64 (openssl rand -base64 32)
// Bind R2 as MODS.
// Paid files are not given a public URL. The seal can be stored on the mod
// document; only this worker can turn it back into an object.
//
// Deploy: npx wrangler deploy --config worker/upload.toml

import {
  assertAdmin, bearer, clientIp, corsHeaders, hasPurchase, hitLimit, json, openSeal,
  readPublicOrAdmin, safeDownloadName, sealKey, verifyFirebaseIdToken
} from './google.js';

const IMAGE_MAX = 5 * 1024 * 1024;
const FILE_MAX_DEFAULT = 200 * 1024 * 1024;
const MOD_EXT = new Set(['.jar', '.zip', '.mrpack', '.mcpack', '.mcaddon', '.7z', '.rar']);

function sniffImage(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return '.gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return '.webp';
  return null;
}

function limitStream(stream, max) {
  let seen = 0;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength || chunk.length || 0;
      if (seen > max) throw new Error('too_large');
      controller.enqueue(chunk);
    }
  }));
}

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return match ? match[1] : '';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

    const ip = clientIp(request);
    if (hitLimit(ip, url.pathname === '/download' ? 'download' : 'upload', 30, 15 * 60 * 1000)) {
      return json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, 429, cors);
    }

    const token = bearer(request);
    const user = await verifyFirebaseIdToken(token);
    if (!user) return json({ error: 'Please sign in first.' }, 401, cors);

    if (url.pathname === '/download') return download(request, env, user, token, cors);
    if (url.pathname !== '/' && url.pathname !== '') return json({ error: 'Not found.' }, 404, cors);
    return upload(request, env, user, token, cors);
  }
};

async function upload(request, env, user, token, cors) {
  const admin = await assertAdmin(user, ['mods', 'edit-mod'], token);
  if (!admin) return json({ error: 'Admins only.' }, 403, cors);

  const kind = request.headers.get('X-Kind') === 'file' ? 'file' : request.headers.get('X-Kind') === 'image' ? 'image' : '';
  if (!kind) return json({ error: 'Upload type is missing.' }, 400, cors);
  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('svg') || contentType.startsWith('text/html')) {
    return json({ error: 'That file type is not allowed.' }, 400, cors);
  }

  const length = Number(request.headers.get('Content-Length') || 0);
  const fileMax = (Number(env.MAX_MOD_FILE_MB) || 200) * 1024 * 1024 || FILE_MAX_DEFAULT;
  const max = kind === 'image' ? IMAGE_MAX : Math.min(fileMax, FILE_MAX_DEFAULT);
  if (!Number.isFinite(length) || length < 1 || length > max) {
    const label = kind === 'image' ? 'Images must be 5 MB or smaller.' : 'That file is too large.';
    return json({ error: label }, 413, cors);
  }

  if (kind === 'image') {
    if (!env.PUBLIC_URL) return json({ error: 'Image hosting is not configured.' }, 503, cors);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > IMAGE_MAX) return json({ error: 'Images must be 5 MB or smaller.' }, 413, cors);
    const ext = sniffImage(bytes);
    if (!ext) return json({ error: 'Images must be PNG, JPG, GIF or WebP.' }, 400, cors);
    const key = `images/${crypto.randomUUID()}${ext}`;
    await env.MODS.put(key, bytes, { httpMetadata: { contentType: ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}` } });
    const base = String(env.PUBLIC_URL).replace(/\/+$/, '');
    return json({ url: `${base}/${key}` }, 200, cors);
  }

  const ext = extensionOf(request.headers.get('X-Filename'));
  if (!MOD_EXT.has(ext)) return json({ error: 'Mod files must be jar, zip, mrpack, mcpack, mcaddon, 7z or rar.' }, 400, cors);
  const key = `mods/${crypto.randomUUID()}${ext}`;
  try {
    await env.MODS.put(key, limitStream(request.body, max), { httpMetadata: { contentType: 'application/octet-stream' } });
  } catch (err) {
    await env.MODS.delete(key);
    if (err && err.message === 'too_large') return json({ error: 'That file is too large.' }, 413, cors);
    console.error('[upload] failed');
    return json({ error: 'Upload failed.' }, 500, cors);
  }
  const seal = await sealKey(env, key);
  if (!seal) {
    await env.MODS.delete(key);
    return json({ error: 'File storage is not configured.' }, 503, cors);
  }
  return json({
    seal,
    fileName: safeDownloadName(request.headers.get('X-Filename') || `download${ext}`)
  }, 200, cors);
}

async function download(request, env, user, token, cors) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'The request could not be read.' }, 400, cors); }
  const modId = typeof body.modId === 'string' ? body.modId : '';
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(modId)) return json({ error: 'Not found.' }, 404, cors);

  const admin = await assertAdmin(user, ['mods', 'edit-mod', 'delete-mod'], token);
  const owned = admin || await hasPurchase(user.sub, modId, token, env);
  if (!owned) return json({ error: 'Buy this mod to download it.' }, 403, cors);

  const mod = await readPublicOrAdmin(env, `mods/${encodeURIComponent(modId)}`);
  if (!mod || mod.__error) return json({ error: 'Not found.' }, 404, cors);
  const versions = Array.isArray(mod.versions) ? mod.versions : [];
  const seal = mod.fileSeal || versions[0]?.fileSeal;
  const fileName = mod.fileName || versions[0]?.fileName || 'download';
  const r2key = await openSeal(env, seal);
  if (!r2key) return json({ error: 'The file for this item is not available yet.' }, 404, cors);
  const obj = await env.MODS.get(r2key);
  if (!obj) return json({ error: 'The file for this item is not available yet.' }, 404, cors);

  const headers = new Headers(cors);
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${safeDownloadName(fileName)}"`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');
  return new Response(obj.body, { status: 200, headers });
}
