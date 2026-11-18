# Casual David Website

A clean, modern personal website for showcasing and selling Minecraft mods, inspired by studiousgoose.com.

## Features

- Responsive single-page design
- Hero section with custom illustration
- Mods shop with Paystack payment integration (cards, bank transfer via Titan Trust Bank, USSD, etc.)
- Social links (YouTube, TikTok, Discord)
- Clean aesthetic focused on casual Minecraft experience

## Setup

1. **Replace placeholder social links** in `index.html` with your real URLs.
2. **Update mods** in `script.js` — edit the `mods` array with your real products, prices (in NGN), and descriptions.
3. **Paystack Integration**:
   - Sign up at [paystack.com](https://paystack.com) if you haven't.
   - Go to Settings → API Keys & Webhooks.
   - Copy your **Public Key** (starts with `pk_test_` or `pk_live_`).
   - Paste it into `script.js` where it says `const publicKey = 'pk_test_xxxxxxxx...';`
   - For production, use your live key and set up a backend to:
     - Verify transactions via Paystack API
     - Automatically email download links after successful payment
     - Handle webhooks for reliability

### Testing Payments

Use Paystack test cards:
- Card: 4084084084084081
- Expiry: any future date
- CVV: 408
- PIN: 0000 (if asked)
- OTP: 123456

Bank transfer (Titan) will also appear as an option in the Paystack checkout.

## Hosting

This is a static site. You can host it for free on:
- Netlify
- Vercel
- GitHub Pages
- Cloudflare Pages

Just upload the `casual-david-site` folder contents.

## Customization

- Colors and fonts are in `styles.css` (CSS variables at the top).
- Add more sections or pages as needed.
- For automatic digital delivery, you'll want a simple backend (Node.js, Python, etc.) or use a service like Gumroad in combination, or Paystack + email automation (e.g., via Zapier or Make).

Enjoy your new site!
