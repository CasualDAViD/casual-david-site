'use strict';

const crypto = require('node:crypto');

class PaystackError extends Error {}

function createPaystack(config) {
  const { secretKey, apiBase } = config.paystack;

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(apiBase + path, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
    } catch (err) {
      throw new PaystackError(`Could not reach Paystack: ${err.message}`);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.status !== true) {
      throw new PaystackError(json?.message || `Paystack returned HTTP ${res.status}`);
    }
    return json.data;
  }

  return {
    // Starts a hosted checkout. The buyer is sent to the returned URL.
    initialize({ email, amountKobo, reference, callbackUrl, metadata }) {
      return call('POST', '/transaction/initialize', {
        email,
        amount: amountKobo,
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata
      });
    },

    // Asks Paystack directly what happened. This is the source of truth,
    // never anything the browser tells us.
    verify(reference) {
      return call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    },

    // Paystack signs every webhook body with HMAC-SHA512 using the secret key.
    validSignature(rawBody, signature) {
      if (!secretKey || typeof signature !== 'string' || !Buffer.isBuffer(rawBody)) return false;
      const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
  };
}

module.exports = { createPaystack, PaystackError };
