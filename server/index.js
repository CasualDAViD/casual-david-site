'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const auth = require('./auth');
const { createModels } = require('./models');
const { createMailer } = require('./mailer');
const { createPaystack } = require('./paystack');

function createApp(config, extra = {}) {
  const db = openDb(config.dataDir);
  const models = createModels(db, config);
  const mailer = extra.mailer || createMailer(config);
  const paystack = createPaystack(config);
  const deps = { db, config, models, mailer, paystack };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // The pages use inline scripts and styles, so these must stay allowed.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'], // blob: lets the admin page preview images before upload
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"]
      }
    },
    // Only send HSTS when the site is really served over HTTPS.
    strictTransportSecurity: config.cookieSecure
  }));

  // Paystack's signature covers the exact bytes, so this one path stays raw.
  app.use('/api/paystack/webhook', express.raw({ type: '*/*', limit: '256kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Blocks cross-site form posts and fetches. Browsers always send Origin on
  // these requests; Paystack's server-to-server webhook sends none.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/api/paystack/webhook') return next();
    const origin = req.get('origin');
    if (origin && origin !== new URL(config.siteUrl).origin) {
      return res.status(403).json({ error: 'bad_origin', message: 'Request blocked.' });
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(auth.attachUser(db));

  app.use('/api/auth/oauth', require('./routes/oauth')(deps));
  app.use('/api/auth', require('./routes/auth')(deps));
  app.use('/api/admin', require('./routes/admin')(deps));
  app.use('/api', require('./routes/shop')(deps));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Not found.' }));

  // Product images. Names are random, so they can be cached for a long time.
  app.use('/uploads', express.static(models.uploadsDir, {
    fallthrough: false,
    immutable: true,
    maxAge: '30d',
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff')
  }));

  app.use(express.static(config.publicDir, { index: 'index.html', dotfiles: 'deny', extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      return res.status(400).json({ error: 'bad_request', message: 'The request could not be read.' });
    }
    if (err && err.status === 404) return res.status(404).send('Not found');
    console.error('[error]', req.method, req.path, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side.' });
  });

  // Clean up expired sessions and reset tokens now and then.
  const sweep = () => {
    const now = auth.nowSec();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(now - 86400);
  };
  sweep();
  const timer = setInterval(sweep, 6 * 60 * 60 * 1000);
  timer.unref();

  return { app, db, models, close: () => { clearInterval(timer); db.close(); } };
}

function start() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const config = loadConfig();
  const { app, db } = createApp(config);

  const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (adminCount === 0) console.warn('[setup] No admin account yet. Run: npm run create-admin');
  if (!config.paystack.enabled) console.warn('[setup] Paystack keys are not set, so buying is switched off.');
  if (config.isProduction && !config.cookieSecure) console.warn('[setup] SITE_URL is not https, so cookies are not marked Secure.');

  const server = app.listen(config.port, config.host, () => {
    console.log(`Casual_DAViD site running at ${config.siteUrl} (listening on ${config.host}:${config.port})`);
  });
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) start();

module.exports = { createApp };
