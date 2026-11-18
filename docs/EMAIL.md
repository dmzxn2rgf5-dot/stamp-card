# Email card recovery (optional)

Out of the box, a Stamp Card lives in the customer's browser. If they clear their browser data or change phone, the card is gone. That's the price of needing no personal data.

Email recovery lets customers **optionally** save their card to an email address and get it back later. It's **off by default**.

## What customers get

- Once a card has a stamp, the card page offers *"Don't lose your stamps – save your card to your email"*. There's an unticked *"Send me occasional offers"* box.
- They confirm the address by tapping a link in their inbox. Only confirmed addresses can recover a card.
- At `/recover` they enter their email and get a link that restores the card in the new browser. Old copies of the card's link and QR stop working. If the new browser already had a card with stamps, those stamps are added in.
- Links are single use, expire after 15 minutes, and are stored only as a hash. Opening a link shows a page with one button, so email scanners that open links automatically can't use them up.
- At most 3 emails per address per hour, and 10 per IP per hour.

## What owners get

- **Admin → Customers** shows each card's email and offers consent. You can send a recovery link, change or remove an email, and export everyone who opted in to offers as CSV.
- **Delete** erases the email and consent and retires the card. Use it for data deletion requests.

With `EMAIL_RECOVERY=off`, none of this appears: no email option on cards, no `/recover`, and no email columns, filters or exports in Admin.

## Turning it on

You need:

1. **A domain on Cloudflare**, e.g. `example.com`. Emails are sent from an address on it.
2. **The Workers Paid plan.** In the Cloudflare dashboard: *Workers & Pages → Plans*. Sending to any customer's address requires it.
3. **Your domain onboarded to Cloudflare Email Service.** In the dashboard: *Email Service → Email Sending → Onboard domain*. Cloudflare adds the SPF and DKIM records for you. Wait until the domain shows as active.

Then, in `wrangler.toml`:

```toml
[vars]
EMAIL_RECOVERY = "on"
EMAIL_FROM = "cards@example.com"

[[send_email]]
name = "EMAIL"
```

and deploy:

```sh
npm run deploy
```

If `EMAIL_RECOVERY` is on but the `EMAIL` binding or `EMAIL_FROM` is missing, customers still don't see the email option, and Admin shows the email columns but can't send links.

**Try it locally first.** In `.dev.vars` set `EMAIL_RECOVERY=on` and `EMAIL_DEV_LOG=1`. Every email, with its link, is printed in the `npm run dev` console instead of being sent.

**Another email provider?** All sending goes through `sendEmail()` in `src/lib/email.ts`. Swap the provider there.

## Cost

- Workers Paid: about **US$5 a month** per Cloudflare account. It also raises the request limits.
- Email sending: check the current quotas and prices in [Cloudflare's Email Service docs](https://developers.cloudflare.com/email-service/) before you go live.
- Your domain, if you don't have one.

## GDPR and privacy

Once customers can save an email, you're collecting personal data. **The venue is the data controller.** You hold the data in your own Cloudflare account. Nobody else, including the Stamp Card project, can see it.

- **Purpose.** Emails are used to send sign-in links. Offers are only sent to customers who ticked the box. That consent is recorded with a date and can be exported.
- **The privacy page** at `/privacy` explains this to customers. Read it, and add your business's contact details if your local rules require them.
- **Requests.** Customers can remove their own email from their card page. For deletion requests, use **Delete** in Admin → Customers.
- **Sending offers.** Stamp Card doesn't send marketing. If you export the opted-in list into a mailing tool, follow your local rules (in the UK, PECR and UK GDPR) and include an unsubscribe link.
- **Processor.** Cloudflare stores the data and sends the emails on your behalf. See Cloudflare's data processing terms.

This is general information, not legal advice.
