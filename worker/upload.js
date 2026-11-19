// Cloudflare Worker — upload proxy for R2
// Deploy this once, set the secrets, then the admin can upload files.

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Filename'
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const filename = request.headers.get('X-Filename') || ('file-' + Date.now());
    const key = 'mods/' + Date.now() + '-' + filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    try {
      await env.MODS.put(key, request.body, {
        httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' }
      });

      const publicUrl = (env.PUBLIC_URL || 'https://pub-b508f8a329c847748aa79ae185525a71.r2.dev') + '/' + key;

      return new Response(JSON.stringify({ url: publicUrl, key }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
