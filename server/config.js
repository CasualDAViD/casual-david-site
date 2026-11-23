'use strict';

const path = require('node:path');

function posInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function posNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value; // e.g. "loopback" or a subnet list
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * Reads settings from environment variables. `overrides` is merged on top and
 * is used by the automated tests (for example to point Paystack at a fake).
 */
function loadConfig(env = process.env, overrides = {}) {
  const port = posInt(env.PORT, 3000);
  const siteUrl = (env.SITE_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  const config = {
    port,
    host: env.HOST || '127.0.0.1',
    siteUrl,
    isProduction: env.NODE_ENV === 'production',
    cookieSecure: siteUrl.startsWith('https://'),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicDir: path.resolve(__dirname, '..', 'public'),
    sessionDays: posInt(env.SESSION_DAYS, 30),
    maxModFileMb: posInt(env.MAX_MOD_FILE_MB, 200),
    maxImageMb: posInt(env.MAX_IMAGE_MB, 5),
    // Same rates the storefront shows. NGN is what Paystack actually charges.
    rates: { USD: 1, NGN: posNum(env.RATE_NGN, 1550), EUR: posNum(env.RATE_EUR, 0.92) },
    rateLimit: { windowMs: 15 * 60 * 1000, limit: 20 },
    paymentRateLimit: { windowMs: 15 * 60 * 1000, limit: 30 },
    webhookRateLimit: { windowMs: 15 * 60 * 1000, limit: 120 },
    paystack: {
      secretKey: env.PAYSTACK_SECRET_KEY || '',
      publicKey: env.PAYSTACK_PUBLIC_KEY || '',
      apiBase: 'https://api.paystack.co'
    },
    mail: {
      host: env.SMTP_HOST || '',
      port: posInt(env.SMTP_PORT, 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || ''
    },
    oauth: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userUrl: 'https://openidconnect.googleapis.com/v1/userinfo'
      },
      discord: {
        clientId: env.DISCORD_CLIENT_ID || '',
        clientSecret: env.DISCORD_CLIENT_SECRET || '',
        authUrl: 'https://discord.com/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        userUrl: 'https://discord.com/api/users/@me'
      }
    }
  };

  const merged = deepMerge(config, overrides);

  // Derived flags, computed after overrides so tests can switch features on.
  // Payments use Paystack's hosted page, so only the secret key is required.
  merged.paystack.enabled = Boolean(merged.paystack.secretKey);
  merged.mail.enabled = Boolean(merged.mail.host && merged.mail.from);
  for (const p of Object.values(merged.oauth)) {
    p.enabled = Boolean(p.clientId && p.clientSecret);
  }
  merged.cookieSecure = merged.siteUrl.startsWith('https://');
  return merged;
}

module.exports = { loadConfig };
