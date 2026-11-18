# Set up your own Stamp Card

This guide takes you from nothing to a working loyalty card on your counter. You don't need to be a developer. Allow about 30 minutes. Every step is free.

You'll type a few commands into a **terminal**. On a Mac, open the **Terminal** app. On Windows, open **PowerShell**. Copy each command, paste it in and press Enter.

> 📷 *Screenshot placeholders are marked like this. Add your own when you publish a guide for your venue.*

---

## 1. Create a Cloudflare account

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and create a free account.
2. Confirm your email address.

You don't need a domain or a paid plan.

## 2. Install Node.js

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version.
2. Run the installer and accept the defaults.
3. Check it worked by running:
   ```sh
   node --version
   ```
   You should see v22.12 or higher.

## 3. Get the code

If you have Git installed:

```sh
git clone https://github.com/dmzxn2rgf5-dot/stamp-card.git
cd stamp-card
```

No Git? On the GitHub page, click **Code → Download ZIP**, unzip it, then in the terminal `cd` into the unzipped folder.

Then install the project's tools. This takes a minute:

```sh
npm install
```

## 4. Log in to Cloudflare from the terminal

```sh
npx wrangler login
```

A browser window opens. Click **Allow**.

## 5. Create your settings file

```sh
cp wrangler.toml.example wrangler.toml
```

(On Windows PowerShell: `copy wrangler.toml.example wrangler.toml`)

`wrangler.toml` holds your settings. It stays on your computer and is never uploaded to GitHub.

## 6. Create the database

```sh
npx wrangler d1 create stamp-card-db
```

The output includes a line like `database_id = "1a2b3c…"`. Open `wrangler.toml` in any text editor, find `REPLACE_WITH_YOUR_DATABASE_ID`, and paste your ID in its place. Save the file.

While it's open, you can also:

- change `name = "stamp-card"` to something like `name = "harbour-bar-card"`. This becomes part of your web address.
- set `TIMEZONE` if you're not in the UK (for example `"Europe/Paris"` or `"America/New_York"`).

> 📷 *wrangler.toml with the database ID filled in*

## 7. Set your setup password

Choose a long random password. It only unlocks the setup wizard once. Keep it somewhere safe until setup is done.

```sh
npx wrangler secret put SETUP_TOKEN
```

Paste your password when asked. (The first time, Wrangler may ask to create the Worker. Say yes.)

## 8. Deploy

```sh
npm run deploy
```

This creates the database tables and puts your app online. At the end it prints your address, something like `https://harbour-bar-card.<your-subdomain>.workers.dev`.

> 📷 *deploy output showing the address*

## 9. Run the setup wizard

Open this address in your browser, using your own address and password:

```
https://harbour-bar-card.<your-subdomain>.workers.dev/setup?token=YOUR_SETUP_TOKEN
```

The wizard has five steps:

1. **You.** Your name and a 4–6 digit PIN. You'll use these to log in on any device.
2. **Your business.** Name, type of venue and logo (PNG, JPG, WebP or SVG, up to 200 KB).
3. **Colours.** Primary, secondary and text colours, with a live preview of the card and the offer pop-up.
4. **Rewards.** How many stamps earn a reward (3–20), what the reward is, and the stamp icon.
5. **Done.** Links to the counter poster and to Admin.

After the wizard, the setup page disappears for good. Everything you chose can be changed later in **Admin**.

> 📷 *the wizard's colour step with the live preview*

## 10. Print the counter poster

From the last wizard step, or **Admin → Counter poster**, press **Print (A5)**. Put the poster where customers queue. Scanning it opens their card.

## 11. Add your staff

In **Admin → Staff**, add each person with a name and PIN. Staff log in at `/staff` on their own phone and stay logged in for 30 days.

## 12. Try it

1. Scan the poster with your phone and you'll see your new card.
2. Log in at `/staff` on another phone, scan the card's QR code, choose 1 stamp and press **Confirm**.
3. The card fills in within a couple of seconds.

---

## Optional extras

- **Your own address** (like `cards.yourshop.com`): in the Cloudflare dashboard, open your Worker, then **Settings → Domains & Routes → Add → Custom domain**. Then set `PUBLIC_URL` in `wrangler.toml` and run `npm run deploy` again.
- **Email card recovery**: see [EMAIL.md](EMAIL.md).
- **All the settings**: see [CONFIG.md](CONFIG.md).

## Updating to a new version

```sh
git pull
npm install
npm run deploy
```

`npm run deploy` always applies any new database changes before deploying.

## Something went wrong?

| Problem | Fix |
| --- | --- |
| `/setup` says "Page not found" | Check the token in the address matches `SETUP_TOKEN` exactly. Setup also disappears once an owner exists. Log in at `/staff/login` instead |
| Deploy says the database ID is invalid | Re-check step 6. Paste the ID between the quotes |
| Forgot the owner PIN | Another owner can reset it in Admin → Staff. If you're the only owner, run `npx wrangler d1 execute DB --remote --command "UPDATE staff SET role='barista', active=0 WHERE role='owner'"`, then open `/setup?token=…` again to create a new owner. Old owner accounts are switched off, not deleted. Cards, stamps and your shop settings are kept (the wizard will save its choices over your settings, so re-enter them) |
| Logins fail with error 1102 | Your PIN hashing is using too much CPU on the free plan. See "PIN hashing" in [CONFIG.md](CONFIG.md) |
