# Changelog

## v1.2.0

- **Website.** A static marketing site in `site/`, built by `scripts/build-site.py` and published free on GitHub Pages at https://dmzxn2rgf5-dot.github.io/stamp-card/ by a new `pages.yml` workflow. It has pages for 18 venue types and 6 countries, an enquiry form that sends straight to Web3Forms, a sitemap, robots.txt and an IndexNow key.
- **"Get it for your venue" now opens the website.** The Powered-by footer link opens the enquiry form at `/get-it/` on the website in a new tab. The old in-app `/get-stamp-card` page redirects there. Both are still hidden when the owner turns the footer off.
- **Counter poster line.** A small, muted line at the bottom of the printable poster: "Run a café, bar or takeaway? Get Stamp Card free – <website>". It follows the "Powered by Stamp Card" setting.
- README: links to the website and the enquiry form near the top, the paid options and "Get in touch" point to the website's form, and the setup time now says "under an hour".

## v1.1.0

- Enquiry form: a required "What would you like?" choice (Guided kit – £25, Done for you – £199, Just curious). The choice leads the email subject and is the first line of the email. New success message: "Thanks! We'll email you within 24 hours."
- Admin → Brand: a short note under the "Powered by Stamp Card" setting, and one gentle confirm ("Keep it on" / "Turn it off") when saving it switched off. The setting works exactly as before.
- README: a "Try the live demo" link to the public demo, and the paid options and "Get in touch" now link to the enquiry form on the demo.

## v1.0.0

First public release of Stamp Card – the loyalty card alternative.

- Customer stamp card in the browser: no app, no account, live updates, home-screen install, offline view.
- Staff stamping with the phone camera or the built-in scanner, redeem, 5-minute undo, double-tap protection and daily limits.
- Owner admin: stats, staff and PINs, logged-in devices, activity log, CSV export, printable counter poster.
- Customers page: search, filters, stamp adjustments with a reason, history, delete.
- Broadcast offers that pop up over customers' cards.
- First-run setup wizard: owner account, business name, venue type, logo, colours with live preview, stamps and reward.
- Branding stored in the database and editable in Admin: logo (stored in D1, served from `/logo`), colours, fonts, built-in stamp icons (circle, cup, glass, plate, star) or your own upload.
- "Powered by Stamp Card · Get it for your venue" footer line, linking to an enquiry form at `/get-stamp-card` (sent on via Web3Forms, 5 an hour per IP). Turning the footer off hides the form too.
- Optional email card recovery, off by default (`EMAIL_RECOVERY`). With it off, every email feature is hidden and the app runs on Cloudflare's free plan.
- `PUBLIC_URL` for QR codes and emails behind a custom domain.
- Docs, a demo seed for local screenshots, and CI running type-check, lint, tests and a clean check.
