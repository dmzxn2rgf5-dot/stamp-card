// "Get it for your venue": the Powered-by footer links to the enquiry form on the
// Stamp Card website (GET_IT_URL). /get-stamp-card redirects there for old links.
// /api/enquiry is kept for copies of the old in-app form still open in browsers.
// All of it is hidden (404) when the owner turns the footer off.
import { type Context, Hono } from "hono";
import { ENQUIRY_ACCESS_KEY, ENQUIRY_ENDPOINT, ENQUIRY_LIMIT_PER_HOUR } from "../config";
import { GET_IT_URL, PROJECT_NAME, VENUE_PRESETS, VENUE_TYPES, type VenueType } from "../defaults";
import { normaliseEmail } from "../lib/email";
import { HOUR, hit } from "../lib/ratelimit";
import { resolveTheme } from "../lib/theme";
import { publicOrigin } from "../lib/url";
import type { AppEnv } from "../types";

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

// The enquiry form now lives on the Stamp Card website. Old links still work.
app.get("/get-stamp-card", (c) => (formOn(c) ? c.redirect(GET_IT_URL, 301) : c.notFound()));

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
