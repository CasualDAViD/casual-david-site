# Casual_DAViD website

A Minecraft mod store with a real backend: accounts, an admin panel, Paystack payments that are verified on the server, and paid file downloads.

- **`public/`** is the website (HTML, CSS, browser JavaScript).
- **`server/`** is the backend (Node.js + Express + SQLite).
- **`test/`** is the automated test suite (`npm test`).

## What it does

| Area | How it works |
|---|---|
| Accounts | Sign up and sign in with email and password (hashed with scrypt), or with Google / Discord. Sessions are HttpOnly cookies. |
| Password reset | Emails a one-hour, single-use link. |
| Admin | Sign in at `/admin.html` with an admin account. Add, edit and delete mods, upload each mod's **file** plus icon and screenshots, edit social links, see orders. |
| Shop | Mods and social links are stored on the server, so every visitor sees them. |
| Payments | Checkout creates an order, sends the buyer to Paystack, then the server confirms the payment with Paystack (and via webhook) before unlocking anything. The amount is always checked against the order. |
| Downloads | Mod files are stored privately. Only buyers (and admins) can download them, from the purchase history or the "payment complete" page. |
| Receipts | Emailed after payment when email is set up. |

Prices are entered in **USD**. Paystack charges in **naira** at the rate in `RATE_NGN`; checkout shows the exact naira amount.

## Run it locally

```bash
npm install
cp .env.example .env        # then edit it (all of it is optional locally)
npm run create-admin -- you@example.com
npm start                   # http://localhost:3000
```

With no Paystack key the shop works but buying is switched off. With no SMTP settings, email features are hidden. With no Google/Discord keys, those buttons are hidden.

## GitHub Pages

`casualdavid.com.ng` points at GitHub Pages. Pages was not publishing this repo, so every URL returned GitHub's own "There isn't a GitHub Pages site here" page.

The HTML is in `public/`. A branch publish can only use the repo root or `/docs`, so turning the old "main branch, / folder" setting back on would still 404: there is no `index.html` at the root. `.github/workflows/pages.yml` publishes `public/` instead, and does not run Jekyll.

Pages can only serve the HTML, CSS, and images. Accounts, the shop, and payments need the Node server in the next section. Use one host for the domain, not both.

After this is merged:

1. On GitHub, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
2. Under **Custom domain**, enter `casualdavid.com.ng`. GitHub shows a TXT record named `_github-pages-challenge.casualdavid.com.ng`. Add that exact record at the DNS host (WhoGoHost), then come back and verify. There is no verification record today.
3. If **Publish site** did not run on the merge, open **Actions → Publish site → Run workflow**.

Leave the existing A records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and the `www` CNAME (`casualdavid.github.io`) in place while the site stays on Pages.

## Deploy on your VPS (Ubuntu example)

1. **Install** Node **22 or newer** (the SQLite library requires it) and nginx: `sudo apt install nginx`, with Node from nodesource or `nvm`. Check with `node -v`.
2. **Get the code** into `/opt/casual-david-site`, then `npm ci --omit=dev`. (The included `.npmrc` skips install scripts; the SQLite library ships ready-made binaries for Linux x64/arm64, macOS and Windows, so no compiler is needed.)
3. **Create a user and data folder**
   ```bash
   sudo useradd --system --home /opt/casual-david-site casualdavid
   sudo mkdir -p /var/lib/casual-david && sudo chown casualdavid: /var/lib/casual-david
   sudo chown -R casualdavid: /opt/casual-david-site
   ```
4. **Configure**: `cp .env.example .env`, fill it in (set `SITE_URL` to your real https address and `DATA_DIR=/var/lib/casual-david`), and `chmod 600 .env`.
5. **Create your admin account** (this replaces the old hard-coded password):
   `sudo -u casualdavid npm run create-admin -- you@example.com`
6. **Start the service**: copy `deploy/casual-david.service` to `/etc/systemd/system/`, then `sudo systemctl enable --now casual-david`.
7. **Web server and HTTPS**: use `deploy/nginx.conf`, then `sudo certbot --nginx -d your-domain`.
8. **Point the domain's DNS at the VPS** (replace the GitHub Pages A records). The Node server does not read the `CNAME` file; that file is only for GitHub Pages. Do not leave the domain on Pages and the VPS at the same time.
9. **Paystack**: in the dashboard add the webhook `https://your-domain/api/paystack/webhook` and put your secret key in `.env`. Test with a `sk_test_` key first.

### Updating
`git pull && npm ci --omit=dev && sudo systemctl restart casual-david`. The database upgrades itself on start.

### Backups
Everything that matters is in `DATA_DIR` (`site.db`, `uploads/`, `private-files/`). Back that folder up regularly. For a clean database snapshot while running: `sqlite3 /var/lib/casual-david/site.db ".backup /backups/site-$(date +%F).db"`.

## Setting up Google and Discord sign-in

Create an OAuth app with each provider and register these redirect URLs (using your real address):

- Google (Cloud Console > APIs & Services > Credentials): `https://your-domain/api/auth/oauth/google/callback`
- Discord (Developer Portal > OAuth2): `https://your-domain/api/auth/oauth/discord/callback`

Put the client ID and secret in `.env` and restart. Only accounts whose email the provider has verified can sign in.

## Things worth knowing

- **Email is not verified at sign-up.** If someone registers with a password using an address and the real owner later signs in with Google/Discord, the password on that unverified account is removed and its sessions end (so nobody can squat on someone else's email). A password reset link also counts as verification.
- Deleting a mod hides it from the shop but keeps the file, so existing buyers can still download it.
- Login attempts are rate-limited per IP (20 failures per 15 minutes).
- Never commit `.env` or `data/`; `.gitignore` already excludes them.

## Tests

`npm test` runs the whole suite against a fake Paystack and a fake Google, so no real money or accounts are involved.

## Projects (admin → Mods → Create project)

The admin's mod form is a CurseForge-style wizard: **General** (name, logo, summary, class, main and extra categories, unlisted, social links), **Description** (Markdown with toolbar and live preview; raw HTML is never rendered), **Pricing & Files** (price, mod file, gallery) and **License**. Classes, categories, licenses and link types live in `server/catalog.js`; edit that file to change the dropdowns. Existing mods are upgraded automatically on first start.
