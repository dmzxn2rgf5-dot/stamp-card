# Security

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Email **security@example.com** with:

- what you found and where (URL path, file, or line),
- the steps to reproduce it,
- what an attacker could do with it.

You'll get a reply within a week. Please give us a reasonable time to fix it before you talk about it publicly. We'll credit you in the release notes unless you'd rather we didn't.

Only the latest release is supported. If you run your own deploy, update to it with `git pull && npm install && npm run deploy`.

## How Stamp Card protects cards and staff

- **Card secret.** 24 random base62 characters (about 142 bits), held in the card's URL, an `HttpOnly; Secure; SameSite=Lax` cookie and localStorage. It's never shown on screen and never put in the QR code.
- **Scan code.** 10 random characters in the QR. It only works on staff pages behind login and can never open the customer's card.
- **Staff sessions.** 30-day `HttpOnly; Secure; SameSite=Strict` cookie. Only a SHA-256 hash of the token is stored. PINs are hashed with PBKDF2.
- **Requests.** Every `POST`, `PATCH` and `DELETE` must come from the same origin.
- **Consistent stamps.** Stamp, redeem and undo write the event and the card update together, guarded by the card's version, so two staff can't overwrite each other. A double tap counts once.
- **Rate limits** on logins, stamping, new cards, setup and email.
- **Headers.** Strict Content Security Policy (scripts only from this site), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on card data.
- **Uploads.** Logos and stamp icons are limited to 200 KB of PNG, JPEG, WebP or SVG. SVGs with scripts, event handlers, links to other files or embedded content are refused, and stored SVGs are served with a sandboxing CSP.
- **Enquiry form.** Fields are stripped of HTML and the email is validated by the Worker before the browser sends anything to Web3Forms. There's a hidden honeypot field and a limit of 5 sends an hour per IP.
- **Setup.** `/setup` needs the `SETUP_TOKEN` secret and returns 404 once an owner exists.
- **Email links** (when email recovery is on). Single use, 15-minute expiry, stored only as a hash, and used by a button press rather than by opening the link.
