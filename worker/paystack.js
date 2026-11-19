// Cloudflare Worker — Paystack initialize + verify
// Set secret: PAYSTACK_SECRET_KEY
// Optional: PAYSTACK_PUBLIC_KEY (not required for redirect flow)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method === 'POST' && url.pathname === '/') {
      try {
        const body = await request.json();
        const { email, amountUsd, modId, modName, userId, callbackUrl } = body;

        if (!email || !amountUsd || !modId) {
          return new Response(JSON.stringify({ error: 'Missing email, amountUsd or modId' }), {
            status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
          });
        }

        // Convert USD to NGN kobo (approx 1550 NGN per USD). Adjust rate if needed.
        const rate = 1550;
        const amountNgn = Math.round(Number(amountUsd) * rate);
        const amountKobo = amountNgn * 100;

        const reference = 'cd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            amount: amountKobo,
            currency: 'NGN',
            reference,
            callback_url: callbackUrl || 'https://casualdavid.com.ng/order-complete.html',
            metadata: {
              modId,
              modName: modName || '',
              userId: userId || '',
              amountUsd: Number(amountUsd),
              amountNgn
            }
          })
        });

        const data = await initRes.json();
        if (!data.status) {
          return new Response(JSON.stringify({ error: data.message || 'Init failed' }), {
            status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          authorization_url: data.data.authorization_url,
          reference: data.data.reference,
          amountNgn
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    }

    if (request.method === 'GET' && url.pathname === '/verify') {
      const reference = url.searchParams.get('reference');
      if (!reference) {
        return new Response(JSON.stringify({ error: 'Missing reference' }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      try {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
        });
        const data = await verifyRes.json();

        if (!data.status || data.data.status !== 'success') {
          return new Response(JSON.stringify({ success: false, message: data.message || 'Not successful' }), {
            headers: { ...cors, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          reference: data.data.reference,
          amount: data.data.amount,
          currency: data.data.currency,
          metadata: data.data.metadata || {},
          paid_at: data.data.paid_at
        }), {
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not found', { status: 404, headers: cors });
  }
};
