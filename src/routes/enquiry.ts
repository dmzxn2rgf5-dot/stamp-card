// "Get it for your venue" enquiry form, linked from the Powered-by footer.
// Neutral Stamp Card styling, not the shop's. Hidden when the owner turns the
// footer off. Submissions go to Web3Forms (from the visitor's browser), which
// emails them on.
import { type Context, Hono } from "hono";
import { ENQUIRY_ACCESS_KEY, ENQUIRY_ENDPOINT, ENQUIRY_LIMIT_PER_HOUR } from "../config";
import { DEFAULTS, PROJECT_NAME, PROJECT_URL, VENUE_PRESETS, VENUE_TYPES, type VenueType } from "../defaults";
import { normaliseEmail } from "../lib/email";
import { html } from "../lib/html";
import { HOUR, hit } from "../lib/ratelimit";
import { resolveTheme, type Theme } from "../lib/theme";
import { publicOrigin } from "../lib/url";
import type { AppEnv, ShopRow } from "../types";
import { page } from "../views/layout";

const app = new Hono<AppEnv>();

/** "What would you like?" choices on the enquiry form. The label goes in the email subject. */
export const ENQUIRY_OPTIONS = {
  kit: { label: "Guided kit", price: "£25", detail: "Step-by-step guide to build it yourself with Claude." },
  done: { label: "Done for you", price: "£199", detail: "We set it up, branded and ready to scan." },
  curious: { label: "Just curious", price: "", detail: "Tell me more." },
} as const;
export type EnquiryOption = keyof typeof ENQUIRY_OPTIONS;
const optionText = (k: EnquiryOption) => {
  const o = ENQUIRY_OPTIONS[k];
  return o.price ? `${o.label} – ${o.price}` : o.label;
};

/** The project's own look, whatever the shop's branding is. */
export function neutralTheme(shop: ShopRow): Theme {
  return resolveTheme({
    ...shop,
    name: PROJECT_NAME,
    logo_url: null,
    theme: "{}",
    primary_colour: DEFAULTS.colours.primary,
    secondary_colour: DEFAULTS.colours.secondary,
    text_colour: DEFAULTS.colours.text,
    broadcast_bg: "secondary",
  });
}

const formOn = (c: Context<AppEnv>) => resolveTheme(c.var.shop).poweredBy;

/** Plain text only: drop tags and anything that could be read as markup, trim, cap the length. */
export function stripHtml(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/<[^>]*>?/g, "")
    .replace(/[<>]/g, "")
    .split("")
    .filter((ch) => {
      const n = ch.charCodeAt(0);
      return n === 9 || n === 10 || n === 13 || (n >= 32 && n !== 127); // no control characters
    })
    .join("")
    .trim()
    .slice(0, max);
}

app.get("/get-stamp-card", (c) => {
  if (!formOn(c)) return c.notFound();
  const t = neutralTheme(c.var.shop);
  const sent = c.req.query("sent") === "1";
  const origin = new URL(ENQUIRY_ENDPOINT).origin;
  c.header(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; ` +
      `connect-src 'self' ${origin}; form-action ${origin}; frame-ancestors 'none'; base-uri 'none'`,
  );
  return c.html(
    page({
      title: `Get ${PROJECT_NAME} for your venue`,
      theme: t,
      body: html`<main class="wrap center enquiry">
        <header class="brand brand-sm"><img class="brand-logo" src="${t.logo}" alt="" width="56" height="56"><p class="brand-name">${PROJECT_NAME}</p></header>
        <section class="panel">
          <h1 class="display">Want ${PROJECT_NAME} for your venue?</h1>
          <p>No app. No subscription. Pick an option, leave your email, and we'll send you everything you need.</p>
          <p class="alert ok ${sent ? "" : "hidden"}" id="enquiry-done" role="status">Thanks! We'll email you within 24 hours.</p>
          <form id="enquiry-form" method="post" action="${ENQUIRY_ENDPOINT}" class="${sent ? "hidden" : ""}" novalidate>
            <input type="hidden" name="access_key" value="${ENQUIRY_ACCESS_KEY}">
            <input type="hidden" name="subject" value="${PROJECT_NAME} enquiry">
            <input type="hidden" name="from_name" value="${PROJECT_NAME}">
            <input type="hidden" name="deployment" value="${publicOrigin(c.env, c.req.url)}">
            <fieldset class="enquiry-options">
              <legend>What would you like?</legend>
              ${(Object.keys(ENQUIRY_OPTIONS) as EnquiryOption[]).map(
                (k) => html`<label class="enquiry-option">
                  <input type="radio" name="choice" value="${optionText(k)}" data-choice="${k}" required>
                  <span><strong>${ENQUIRY_OPTIONS[k].label}${ENQUIRY_OPTIONS[k].price ? html` – ${ENQUIRY_OPTIONS[k].price}` : ""}.</strong> ${ENQUIRY_OPTIONS[k].detail}</span>
                </label>`,
              )}
            </fieldset>
            <label class="field">Email
              <input type="email" name="email" required maxlength="254" autocomplete="email" inputmode="email"></label>
            <label class="field">Venue name <span class="muted">(optional)</span>
              <input type="text" name="venueName" maxlength="120" autocomplete="organization"></label>
            <label class="field">Venue type
              <select name="venueType">
                ${VENUE_TYPES.map((v) => html`<option value="${v}">${VENUE_PRESETS[v].label}</option>`)}
              </select></label>
            <input type="checkbox" name="botcheck" class="hidden" tabindex="-1" autocomplete="off" aria-hidden="true">
            <div class="alert hidden" id="enquiry-error" role="alert"></div>
            <button class="btn btn-primary btn-block" type="submit">Send</button>
            <p class="small muted">Your details go to the ${PROJECT_NAME} team, not to this venue, and are only used to reply to you.</p>
          </form>
        </section>
        <p class="small">Rather set it up yourself? <a href="${PROJECT_URL}" target="_blank" rel="noopener">${PROJECT_NAME} on GitHub</a></p>
      </main>`,
      scripts: ["/js/enquiry.js"],
    }),
  );
});

// Checks, cleans and rate-limits an enquiry, then hands the finished Web3Forms
// payload back to the browser, which posts it to Web3Forms itself. (Web3Forms'
// free plan only accepts submissions from browsers, not from servers.)
app.post("/api/enquiry", async (c) => {
  if (!formOn(c)) return c.notFound();
  const ip = c.req.header("CF-Connecting-IP") || "local";
  if ((await hit(c.env.DB, `enquiry:${ip}`, HOUR)).count > ENQUIRY_LIMIT_PER_HOUR) {
    return c.json({ ok: false, message: "Too many messages from this connection. Please try again later." }, 429);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json({ ok: false, message: "Please fill in the form." }, 400);
  const choice = typeof body.choice === "string" && Object.hasOwn(ENQUIRY_OPTIONS, body.choice) ? (body.choice as EnquiryOption) : null;
  if (!choice) return c.json({ ok: false, message: "Please pick an option." }, 400);
  const email = normaliseEmail(stripHtml(body.email, 254));
  if (!email) return c.json({ ok: false, message: "Please enter a valid email address." }, 400);
  // A bot filled in the hidden field: look successful, send nothing.
  if (body.botcheck) return c.json({ ok: true, endpoint: null, payload: null });

  const venueName = stripHtml(body.venueName, 120);
  const venueType = VENUE_TYPES.includes(body.venueType as VenueType) ? (body.venueType as VenueType) : "other";
  return c.json({
    ok: true,
    endpoint: ENQUIRY_ENDPOINT,
    payload: {
      access_key: ENQUIRY_ACCESS_KEY,
      // First field, so it's the first line of the email body.
      choice: optionText(choice),
      subject: `${PROJECT_NAME} enquiry – ${ENQUIRY_OPTIONS[choice].label} – ${venueName || "No venue name"}`,
      from_name: PROJECT_NAME,
      replyto: email,
      email,
      venue_name: venueName || "(not given)",
      venue_type: VENUE_PRESETS[venueType].label,
      deployment: publicOrigin(c.env, c.req.url),
      botcheck: "",
    },
  });
});

export default app;
