// Cloudflare Worker: create admin sub-users.
// Only the main admin's verified Firebase login can call this.
//
// Secrets:
//   FIREBASE_SERVICE_ACCOUNT   preferred, full JSON, one line
//   FIREBASE_API_KEY           fallback server key only. Do not reuse the
//                              website key once that key has HTTP-referrer limits.
//   RESEND_API_KEY             optional, to email the temporary password
//   EMAIL_FROM                 optional
//
// Deploy: npx wrangler deploy --config worker/admin-users.toml

import {
  ADMIN_PERMS, assertAdmin, bearer, clientIp, corsHeaders, createAuthUser, deleteAdminDoc,
  deleteAuthUser, escapeHtml, hitLimit, json, verifyFirebaseIdToken, writeAdminDoc
} from './google.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

async function sendEmail(env, to, tempPassword) {
  if (!env.RESEND_API_KEY) return false;
  const from = env.EMAIL_FROM || 'Casual_DAViD <onboarding@resend.dev>';
  const safeTo = escapeHtml(to);
  const safePassword = escapeHtml(tempPassword);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Casual_DAViD admin access',
      html: `<p>You've been added as an admin on Casual_DAViD.</p>
        <p><strong>Email:</strong> ${safeTo}</p>
        <p><strong>Temporary password:</strong> ${safePassword}</p>
        <p>Sign in at <a href="https://casualdavid.com.ng/privateadmin">the admin page</a>, then set a new password. The temporary password stops working after that.</p>`
    })
  });
  return res.ok;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, 'POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (hitLimit(clientIp(request), 'admin-users', 10, 60 * 60 * 1000)) {
      return json({ success: false, error: 'Too many attempts. Please wait and try again.' }, 429, cors);
    }

    const token = bearer(request);
    const user = await verifyFirebaseIdToken(token);
    const admin = user ? await assertAdmin(user, [], token) : null;
    if (!admin || admin.role !== 'main') {
      return json({ success: false, error: 'Admins only.' }, 403, cors);
    }

    if (request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ success: false, error: 'The request could not be read.' }, 400, cors); }
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
      if (!EMAIL_RE.test(email) || email.length > 254) {
        return json({ success: false, error: 'Enter a valid email address.' }, 400, cors);
      }
      if (!permissions.length || permissions.some((perm) => !ADMIN_PERMS.includes(perm))) {
        return json({ success: false, error: 'Choose a valid set of permissions.' }, 400, cors);
      }
      if (email === 'okpeidavid7@gmail.com') {
        return json({ success: false, error: 'That account is already the main admin.' }, 400, cors);
      }

      const tempPassword = randomPassword();
      const created = await createAuthUser(env, email, tempPassword);
      if (!created.uid) return json({ success: false, error: created.error || 'Could not create that account.' }, 400, cors);
      const saved = await writeAdminDoc(created.uid, email, permissions, token);
      if (!saved) {
        await deleteAuthUser(env, created.uid);
        return json({ success: false, error: 'Could not save the admin record.' }, 500, cors);
      }
      const sent = await sendEmail(env, email, tempPassword);
      if (sent) {
        return json({ success: true, message: 'User created and email sent.', uid: created.uid }, 200, cors);
      }
      return json({
        success: true,
        message: 'User created. Email is not configured, so copy the temporary password now. It is not stored.',
        temporaryPassword: tempPassword,
        uid: created.uid
      }, 200, cors);
    }

    if (request.method === 'DELETE') {
      const uid = url.searchParams.get('uid') || '';
      if (!/^[A-Za-z0-9]{6,128}$/.test(uid)) {
        return json({ success: false, error: 'That user could not be found.' }, 400, cors);
      }
      await deleteAdminDoc(uid, token);
      const removed = await deleteAuthUser(env, uid);
      return json({
        success: true,
        message: removed
          ? 'User removed.'
          : 'Admin access removed. Deleting the login itself needs the Firebase service account.'
      }, 200, cors);
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};
