# Configuration

There are two kinds of settings:

- **Shop settings** (name, colours, rewards and so on) are stored in the database. You set them in the setup wizard and change them in **Admin**. No code or redeploy is needed.
- **Deploy settings** are environment variables in `wrangler.toml` (copied from `wrangler.toml.example`), plus secrets set with `npx wrangler secret put`. After changing these, run `npm run deploy`.

## Environment variables

| Variable | Default | Where | Notes |
| --- | --- | --- | --- |
| `SETUP_TOKEN` | none, **required** | Secret: `npx wrangler secret put SETUP_TOKEN` | Unlocks `/setup?token=…` while no owner exists. After setup, `/setup` returns 404 whatever the token |
| `EMAIL_RECOVERY` | `off` | `[vars]` | `on` shows the email features. They need the Workers Paid plan and Cloudflare Email Service. See [EMAIL.md](EMAIL.md). While `off`, every email page, button and endpoint is hidden and the app runs on the free plan |
| `EMAIL_FROM` | none | `[vars]` | Sender address on your own domain, e.g. `cards@example.com`. Email recovery only |
| `PUBLIC_URL` | the address the request came in on | `[vars]` | Your public address, e.g. `https://cards.yourshop.com`, without a trailing slash. Used in the counter poster QR, card QR codes and email links. Set it when you add a custom domain so printed posters always point there |
| `TIMEZONE` | `Europe/London` | `[vars]` | Used for "today", daily stamp limits, stats and offer end dates. Only read when the shop is first created; after that it's stored in the database |
| `SHOP_ID` | `main` | `[vars]` | Internal id stored on every record. Leave it alone after launch |
| `EMAIL_DEV_LOG` | unset | `.dev.vars` (local only) | `1` prints emails to the console instead of sending them. Used for local development and tests |

Bindings in `wrangler.toml`:

| Binding | Required | Notes |
| --- | --- | --- |
| `DB` (D1) | Yes | Database `stamp-card-db`. Paste your own `database_id` |
| `EMAIL` (`[[send_email]]`) | Only for email recovery | Cloudflare Email Service send binding |

## Shop settings (wizard and Admin)

| Setting | Default | Where to change it |
| --- | --- | --- |
| Business name | Your Shop | Wizard step 2, Admin → Loyalty rules |
| Venue type | Coffee shop (first option) | Wizard step 2. It only sets a starting stamp icon and reward: coffee shop → cup, "Free drink"; bar → glass, "Free drink"; restaurant → plate, "Free dessert"; other → circle, "Free reward" |
| Logo | Neutral placeholder | Wizard step 2, Admin → Brand → Logo. PNG, JPEG, WebP or SVG, up to 200 KB, stored in D1 and served from `/logo`. You can use an `https://` logo URL instead. SVGs containing scripts, event handlers, links to other files or embedded content are refused |
| Primary colour | `#2F6FED` | Wizard step 3, Admin → Brand. Filled stamps, buttons, accents |
| Secondary colour | `#0B1F4B` | Wizard step 3, Admin → Brand. Offer pop-up background, headings |
| Text colour | `#FFFFFF` | Wizard step 3, Admin → Brand. Text on the two colours above. You're warned if it's below 4.5:1 contrast (WCAG AA) |
| Broadcast background | Secondary | Admin → Brand |
| Accent, page text, background, panels | Neutral | Admin → Brand → More colours |
| Stamps for a reward | 10 | Wizard step 4, Admin → Loyalty rules. 3–20 |
| Reward label | Free drink | Wizard step 4, Admin → Loyalty rules |
| Stamp icon | Plain circle | Wizard step 4, Admin → Brand. Built in: circle, cup, glass, plate, star. Or upload your own in Admin → Brand → Your own stamp icon (same file rules as the logo, served from `/stamp-icon`) |
| Max stamps per scan | 5 | Admin → Loyalty rules. 1–10 |
| Max stamps per card per day | 10 | Admin → Loyalty rules. 1–50 |
| Tagline | Collect a stamp every visit | Admin → Brand |
| Fonts | System fonts | Admin → Brand. CSS font names, plus an optional Google Fonts link |
| Show name under logo | On | Admin → Brand |
| "Powered by Stamp Card" | On | Admin → Brand. A small line under everything on the customer card: "Powered by Stamp Card · Get it for your venue", linking to the enquiry form on the [Stamp Card website](https://dmzxn2rgf5-dot.github.io/stamp-card/get-it/) in a new tab. It also adds one small line at the bottom of the counter poster. Untick to hide both; `/get-stamp-card` then returns 404 instead of redirecting to the website. Saving it switched off asks once to confirm |

**Reset to defaults** in Admin → Brand resets colours, fonts, icon and logo. Your name, rules, staff and cards are kept.

## Staff roles

| Role | Can |
| --- | --- |
| Owner | Everything, including Admin, Customers, Broadcasts and other staff |
| Staff | Log in, stamp, redeem, and undo their own changes within 5 minutes |

In the database and API the staff role is stored as `barista`, for compatibility. The interface shows it as "Staff".

## Limits built into the app

| Limit | Value |
| --- | --- |
| Failed logins | 5 per 15 minutes, per IP and per staff member |
| Stamp, redeem and undo | 30 a minute per staff session |
| New cards | 20 an hour per IP |
| Setup attempts | 10 an hour per IP |
| Undo | Latest change on a card only, within 5 minutes, by the same person or an owner |
| Staff sessions | 30 days |
| Broadcast message | 280 characters |
| Enquiry form (`/api/enquiry`) | 5 sends an hour per IP |

## PIN hashing

PINs are hashed with PBKDF2 at 100,000 iterations, the maximum Workers allows (`PBKDF2_ITERATIONS` in `src/lib/crypto.ts`). On the free plan this can occasionally go over the 10 ms CPU limit at login. If logins fail with error 1102, lower the number and redeploy. Each hash stores its own iteration count, so existing PINs keep working.

## Live update speed

The card page checks for new stamps every 2 seconds while open (`POLL_MS` in `public/js/card.js`). This is the main use of your free Worker requests. Raise it if a very busy venue gets close to the daily limit.

## Enquiry form

"Get it for your venue" lets people who see a card ask about getting Stamp Card for their own venue. The form is on the Stamp Card website at [https://dmzxn2rgf5-dot.github.io/stamp-card/get-it/](https://dmzxn2rgf5-dot.github.io/stamp-card/get-it/) (`GET_IT_URL` in `src/defaults.ts`), not in your app. The old in-app address `/get-stamp-card` redirects there. Messages go to the Stamp Card project through [Web3Forms](https://web3forms.com), not to you, and nothing is stored in your database. If you run a fork and want enquiries to come to you, point `SITE_URL` and `GET_IT_URL` in `src/defaults.ts` at your own page. To switch the link off, untick "Powered by Stamp Card" in Admin → Brand.

## Website

The marketing site in `site/` is published to GitHub Pages by `.github/workflows/pages.yml` whenever `site/` changes on `main`. Don't edit the HTML by hand. Change `scripts/build-site.py` and run `python3 scripts/build-site.py` (needs `pip install qrcode`), which rebuilds `site/`.
