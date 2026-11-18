# Stamp Card

### The loyalty card alternative.

**No app. No subscription. No running costs. Your brand. Free and open source.**

You know the paper stamp card. The one that ends up in the washing machine. The one customers forget, lose or never pick up in the first place.

And you know the "digital" fix. Download our app. Make an account. Pay us £30, £50, £100 a month. Forever.

Stamp Card is neither.

Your customer scans a QR code on the counter. Their card opens in their phone's browser. That's it. No download. No sign-up. No password. It's just there, every time they come back.

Your staff scan the customer's card with their normal phone camera. Tap +1. The stamp lands on the customer's screen in about two seconds. Card full, reward redeemed. Fresh card. Go again.

---

## Why this exists

I built this for a friend's coffee shop. Every loyalty option we looked at wanted a monthly fee, an app download, or both. For a stamp card. A thing that's worked on paper for decades.

It felt wrong. So I built one that runs for nothing and gave it away.

## Why it's free

Because it costs almost nothing to run, so it shouldn't cost anything to own.

Stamp Card runs on Cloudflare's free tier. No server to rent. No database bill. A small café, a busy bar, a restaurant. It all fits.

The only optional cost is email card recovery, which needs Cloudflare's paid Workers plan at about $5 a month. Leave it switched off and you pay nothing.

No per-customer fees. No "growth plan". No surprise invoice when you get popular.

## What you get

- **No app for anyone.** Not for customers. Not for staff. It's all web pages.
- **No customer logins.** The card lives in their browser and comes back every time.
- **No subscription.** You own it. You host it. Nobody can switch it off or put the price up.
- **Your brand, not ours.** Your name, logo, colours and reward. Set up in your browser, no code needed.
- **Works anywhere you serve people.** Coffee shops, bars, pubs, bakeries, restaurants, food trucks.
- **Staff PINs.** Every stamp is logged against a named person. Undo for mistakes.
- **Owner dashboard.** Stamps today, rewards redeemed, active customers, CSV export.
- **Broadcast offers.** Post a message and it pops up on every customer's card the next time they open it.
- **Email recovery (optional).** Customers can save their card to an email and get it back with a magic link. Still no passwords.
- **Open source.** Read every line. Change anything. Make it yours.

## How it works

1. Print the counter QR code. Stick it by the till.
2. Customer scans it and gets their card instantly.
3. They show their card's QR code when they order.
4. Staff scan it with their phone camera and tap how many stamps.
5. The customer watches the stamps appear.
6. Card full? Staff tap Redeem. Reward given. Fresh card.

No hardware. No till integration. No training beyond "scan it and tap plus".

## Get it running

**Do it yourself (free).** Clone this repo and follow [docs/SETUP.md](docs/SETUP.md). Deploy to your own Cloudflare account, open the setup wizard, add your logo and colours, print your poster. If you're comfortable following steps in a terminal, you'll be live in an afternoon.

**Build it with Claude (£25).** Get the Stamp Card build kit. It has the full product brief, a plain-English setup guide and printable posters. Hand the brief to Claude Code and it builds your own customised version. You don't need to write any code.

**We'll build it for you.** Want it done for you? We set it up on your own Cloudflare account, branded and ready to scan.

## Docs

- [Setup guide](docs/SETUP.md)
- [Settings and config](docs/CONFIG.md)
- [Switching on email recovery](docs/EMAIL.md)
- [Building your own version with Claude](docs/BUILD-WITH-CLAUDE.md)

## Built with

Cloudflare Workers · D1 · Hono · TypeScript · plain HTML and a little JavaScript. No frameworks to babysit. Nothing to patch.

## Licence

MIT. Use it, change it, run your venue with it.

---

*Made in Bournemouth for a friend's coffee shop. If it fills a few more stamp cards out there, brilliant.*
