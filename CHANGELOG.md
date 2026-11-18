# Changelog

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
