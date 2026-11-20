// Cloudflare Worker: create admin sub-users with temporary password and email.
// Deploy this as a new Worker (e.g. casualdavid-admin-users).
//
// Required environment variables / secrets:
// - FIREBASE_API_KEY: your Firebase web API key
// - RESEND_API_KEY: (optional) Resend API key to send emails
// - EMAIL_FROM: (optional) sender address, e.g. "Casual_DAViD <noreply@casualdavid.com.ng>"

const FIREBASE_API_KEY = 'AIzaSyBHuDf1Yrbktjv15mFJtTdLd3YA2XCmDUs';
const PROJECT_ID = 'casualdavid-site';

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

async function createAuthUser(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || 'Failed to create user';
    if (msg.includes('EMAIL_EXISTS')) throw new Error('This email is already registered.');
    throw new Error(msg);
  }
  return data;
}

async function deleteAuthUser(uid) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid })
  });
  return res.ok;
}

async function writeAdminDoc(uid, idToken, email, permissions) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admins/${uid}`;
  const body = {
    fields: {
      email: { stringValue: email },
      role: { stringValue: 'sub' },
      permissions: { arrayValue: { values: permissions.map(p => ({ stringValue: p })) } },
      mustChangePassword: { booleanValue: true },
      createdAt: { integerValue: String(Date.now()) }
    }
  };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Failed to save admin record: ' + text);
  }
}

async function sendEmail(env, to, tempPassword) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no-key' };
  const from = env.EMAIL_FROM || 'Casual_DAViD <onboarding@resend.dev>';
  const html = `
    <p>You've been added as an admin on Casual_DAViD.</p>
    <p><strong>Email:</strong> ${to}</p>
    <p><strong>Temporary password:</strong> ${tempPassword}</p>
    <p>Go to <a href="https://casualdavid.com.ng/privateadmin">the admin page</a>, sign in with this password, then set a new password. The temporary password will stop working after that.</p>
  `;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Casual_DAViD admin access',
      html
    })
  });
  return { sent: res.ok };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method === 'POST') {
      try {
        const { email, permissions } = await request.json();
        if (!email || !permissions?.length) {
          return Response.json({ success: false, error: 'Email and permissions required' }, { status: 400, headers: cors });
        }
        const tempPassword = randomPassword();
        const authData = await createAuthUser(email, tempPassword);
        await writeAdminDoc(authData.localId, authData.idToken, email, permissions);
        const emailResult = await sendEmail(env, email, tempPassword);
        const message = emailResult.sent
          ? 'User created and email sent.'
          : `User created. Temporary password: ${tempPassword} (email not configured — copy this and send it yourself).`;
        return Response.json({ success: true, message, uid: authData.localId }, { headers: cors });
      } catch (err) {
        return Response.json({ success: false, error: err.message }, { status: 400, headers: cors });
      }
    }

    if (request.method === 'DELETE') {
      const uid = url.searchParams.get('uid');
      if (!uid) return Response.json({ success: false, error: 'uid required' }, { status: 400, headers: cors });
      await deleteAuthUser(uid);
      return Response.json({ success: true }, { headers: cors });
    }

    return new Response('Admin users worker', { headers: cors });
  }
};
