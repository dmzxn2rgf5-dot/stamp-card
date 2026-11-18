// Amendment 1 – optional email so a customer can recover their card.
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { cardCookieName, setCardCookie } from "../auth";
import { getCardById, getCardBySecret, logEvent, recoverCard } from "../db";
import { isSecretId, sha256Hex } from "../lib/crypto";
import { publicOrigin } from "../lib/url";
import { emailEnabled, emailFeatureOn, linkEmail, maskEmail, normaliseEmail, sendEmail } from "../lib/email";
import { html } from "../lib/html";
import { HOUR, hit } from "../lib/ratelimit";
import { resolveTheme, type Theme } from "../lib/theme";
import type { AppEnv, CardRow } from "../types";
import { brandHeader, messagePage, page } from "../views/layout";

const app = new Hono<AppEnv>();
type C = Context<AppEnv>;
const theme = (c: C) => resolveTheme(c.var.shop);

export const TOKEN_TTL_MS = 15 * 60_000;
const SENT_MESSAGE = "If that email has a card, we've sent a link. It expires in 15 minutes.";

// ── Tokens ─────────────────────────────────────────────────
// 32 random bytes, base64url. Only the SHA-256 hash is stored.
function newEmailToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const isEmailToken = (t: string) => /^[A-Za-z0-9_-]{43}$/.test(t);

export async function createEmailToken(db: D1Database, cardId: string, email: string, purpose: "verify" | "recover") {
  const token = newEmailToken();
  await db
    .prepare(`INSERT INTO email_tokens (token_hash, card_id, email, purpose, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(await sha256Hex(token), cardId, email, purpose, Date.now() + TOKEN_TTL_MS)
    .run();
  return token;
}

/** Atomically mark a token used. Returns its row only if valid, unused and unexpired. */
async function consumeToken(db: D1Database, token: string, purpose: "verify" | "recover") {
  if (!isEmailToken(token)) return null;
  return db
    .prepare(
      `UPDATE email_tokens SET used_at = ?1 WHERE token_hash = ?2 AND purpose = ?3 AND used_at IS NULL AND expires_at > ?1
       RETURNING card_id, email`,
    )
    .bind(Date.now(), await sha256Hex(token), purpose)
    .first<{ card_id: string; email: string }>();
}

async function tokenLooksValid(db: D1Database, token: string, purpose: string) {
  if (!isEmailToken(token)) return false;
  const row = await db
    .prepare(`SELECT 1 FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(await sha256Hex(token), purpose, Date.now())
    .first();
  return !!row;
}

/** 3 emails per address per hour, 10 per IP per hour. Returns false if over. */
export async function emailRateOk(db: D1Database, email: string, ip: string | null) {
  const a = await hit(db, `email:addr:${email}`, HOUR);
  if (a.count > 3) return false;
  if (ip !== null) {
    const i = await hit(db, `email:ip:${ip}`, HOUR);
    if (i.count > 10) return false;
  }
  return true;
}

const ipOf = (c: C) => c.req.header("CF-Connecting-IP") || "local";
const origin = (c: C) => publicOrigin(c.env, c.req.url);

export async function sendRecoveryLink(c: C, card: Pick<CardRow, "id" | "email">) {
  const t = theme(c);
  const token = await createEmailToken(c.env.DB, card.id, card.email!, "recover");
  return sendEmail(
    c.env,
    t.name,
    linkEmail(t, {
      to: card.email!,
      subject: `Your ${t.name} loyalty card`,
      intro: `Tap the button to open your ${t.name} loyalty card on this phone. Any stamps on the card you're using now will be added to it.`,
      button: "Open my card",
      url: `${origin(c)}/recover/${token}`,
    }),
  );
}

export async function sendVerifyLink(c: C, card: Pick<CardRow, "id">, email: string) {
  const t = theme(c);
  const token = await createEmailToken(c.env.DB, card.id, email, "verify");
  return sendEmail(
    c.env,
    t.name,
    linkEmail(t, {
      to: email,
      subject: `Save your ${t.name} loyalty card`,
      intro: `Tap the button to save your ${t.name} loyalty card to this email. If you ever lose it, you can get your stamps back with a link sent here.`,
      button: "Save my card",
      url: `${origin(c)}/verify/${token}`,
    }),
  );
}

// ── Save email to a card ───────────────────────────────────
// With EMAIL_RECOVERY off (the default) every email page and endpoint is simply not there.
const EMAIL_PATHS = [/^\/api\/card\/[^/]+\/email(\/remove)?$/, /^\/verify\//, /^\/recover(\/|$)/, /^\/api\/recover$/];
app.use("*", async (c, next) => {
  if (!emailFeatureOn(c.env) && EMAIL_PATHS.some((re) => re.test(c.req.path))) return c.notFound();
  await next();
});

app.post("/api/card/:secretId/email", async (c) => {
  const shop = c.var.shop;
  if (!emailEnabled(c.env)) return c.json({ ok: false, message: "Saving by email isn't available yet." }, 503);
  const secretId = c.req.param("secretId");
  const card = isSecretId(secretId) ? await getCardBySecret(c.env.DB, shop.id, secretId) : null;
  if (!card) return c.json({ ok: false, code: "NOT_FOUND", message: "Card not found." }, 404);
  if (card.stamps < 1 && card.rewards_redeemed < 1) return c.json({ ok: false, message: "Collect your first stamp, then you can save your card." }, 400);
  const body = await c.req.json<{ email?: string; optIn?: boolean }>().catch(() => ({}) as Record<string, never>);
  const email = normaliseEmail(body.email);
  if (!email) return c.json({ ok: false, message: "That doesn't look like an email address." }, 400);
  if (!(await emailRateOk(c.env.DB, email, ipOf(c)))) {
    return c.json({ ok: false, message: "Too many emails sent. Please try again in an hour." }, 429);
  }
  const optIn = body.optIn === true;
  const now = Date.now();
  // Saved as pending; becomes usable for recovery only once verified.
  await c.env.DB.prepare(
    `UPDATE cards SET email = ?, email_verified_at = NULL, marketing_opt_in = ?, marketing_opt_in_at = ? WHERE id = ?`,
  )
    .bind(email, optIn ? 1 : 0, optIn ? now : null, card.id)
    .run();
  const sent = await sendVerifyLink(c, card, email);
  if (!sent) return c.json({ ok: false, message: "We couldn't send the email. Please try again later." }, 502);
  return c.json({ ok: true, status: "pending", masked: maskEmail(email) });
});

app.post("/api/card/:secretId/email/remove", async (c) => {
  const shop = c.var.shop;
  const secretId = c.req.param("secretId");
  const card = isSecretId(secretId) ? await getCardBySecret(c.env.DB, shop.id, secretId) : null;
  if (!card) return c.json({ ok: false, code: "NOT_FOUND", message: "Card not found." }, 404);
  await removeEmail(c.env.DB, shop.id, card, null);
  return c.json({ ok: true, status: "none" });
});

export async function removeEmail(db: D1Database, shopId: string, card: CardRow, staffId: string | null) {
  await db.batch([
    db
      .prepare(`UPDATE cards SET email = NULL, email_verified_at = NULL, marketing_opt_in = 0, marketing_opt_in_at = NULL WHERE id = ?`)
      .bind(card.id),
    db.prepare(`UPDATE email_tokens SET used_at = ? WHERE card_id = ? AND used_at IS NULL`).bind(Date.now(), card.id),
  ]);
  if (card.email) await logEvent(db, shopId, card.id, staffId, "email_removed");
}

// ── Verify ─────────────────────────────────────────────────
// GET only shows a button; the POST uses the token. Email link scanners
// (Outlook Safe Links etc.) open GET links and would otherwise burn it.
app.get("/verify/:token", async (c) => {
  const t = theme(c);
  const token = c.req.param("token");
  if (!(await tokenLooksValid(c.env.DB, token, "verify"))) return c.html(expiredPage(t), 410);
  return c.html(confirmPage(t, "Save your card", "Tap below to finish saving your card to your email.", `/verify/${token}`, "Save my card"));
});

app.post("/verify/:token", async (c) => {
  const t = theme(c);
  const shop = c.var.shop;
  const db = c.env.DB;
  const tok = await consumeToken(db, c.req.param("token"), "verify");
  if (!tok) return c.html(expiredPage(t), 410);
  const card = await getCardById(db, shop.id, tok.card_id);
  if (!card || card.email !== tok.email) {
    return c.html(messagePage(t, "Link no longer valid", "This card's email has changed since that link was sent."), 410);
  }
  try {
    await db.prepare(`UPDATE cards SET email_verified_at = ? WHERE id = ? AND email = ?`).bind(Date.now(), card.id, tok.email).run();
  } catch (e) {
    if (!String(e).includes("UNIQUE")) throw e;
    // Another card in this shop is already saved to this email.
    return c.html(
      messagePage(
        t,
        "This email already has a card",
        "Open the card you want to keep, tap “Lost your card?” and we'll send a link. Stamps from the card in that browser are added to it.",
        { href: "/recover", label: "Get my card back" },
      ),
      409,
    );
  }
  await logEvent(db, shop.id, card.id, null, "email_added");
  return c.html(
    messagePage(t, "Card saved", `Your card is saved to ${maskEmail(tok.email)}. If you ever lose it, tap “Lost your card?” to get your stamps back.`, {
      href: `/card/${card.secret_id}`,
      label: "Open my card",
    }),
  );
});

// ── Recover ────────────────────────────────────────────────
app.get("/recover", (c) => c.html(recoverPage(theme(c), emailEnabled(c.env))));

async function requestRecovery(c: C, raw: unknown) {
  const email = normaliseEmail(raw);
  if (!email) return { ok: false as const, message: "That doesn't look like an email address." };
  if (!(await emailRateOk(c.env.DB, email, ipOf(c)))) return { ok: true as const, message: SENT_MESSAGE }; // same answer either way
  const card = await c.env.DB.prepare(
    `SELECT id, email FROM cards WHERE shop_id = ? AND email = ? AND email_verified_at IS NOT NULL AND retired_at IS NULL`,
  )
    .bind(c.var.shop.id, email)
    .first<{ id: string; email: string }>();
  if (card) {
    // Send after responding so timing doesn't reveal whether the email exists.
    c.executionCtx.waitUntil(sendRecoveryLink(c, card));
  }
  return { ok: true as const, message: SENT_MESSAGE };
}

app.post("/api/recover", async (c) => {
  if (!emailEnabled(c.env)) return c.json({ ok: false, message: "Card recovery isn't available yet." }, 503);
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as Record<string, never>);
  const r = await requestRecovery(c, body.email);
  return c.json(r, r.ok ? 200 : 400);
});

// No-JS form version of the same thing.
app.post("/recover", async (c) => {
  const t = theme(c);
  if (!emailEnabled(c.env)) return c.html(recoverPage(t, false), 503);
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const r = await requestRecovery(c, form.email);
  return c.html(recoverPage(t, true, r.message, !r.ok), r.ok ? 200 : 400);
});

app.get("/recover/:token", async (c) => {
  const t = theme(c);
  const token = c.req.param("token");
  if (!(await tokenLooksValid(c.env.DB, token, "recover"))) return c.html(expiredPage(t), 410);
  return c.html(
    confirmPage(t, "Open your card", "Tap below to open your loyalty card on this phone. Stamps from any card already in this browser will be added to it.", `/recover/${token}`, "Open my card"),
  );
});

app.post("/recover/:token", async (c) => {
  const t = theme(c);
  const shop = c.var.shop;
  const db = c.env.DB;
  const tok = await consumeToken(db, c.req.param("token"), "recover");
  if (!tok) return c.html(expiredPage(t), 410);
  const card = await getCardById(db, shop.id, tok.card_id);
  if (!card || card.email !== tok.email || !card.email_verified_at) {
    return c.html(messagePage(t, "Link no longer valid", "This card's email has changed since that link was sent."), 410);
  }
  // The card already in this browser (if any) gets merged in and retired.
  const current = getCookie(c, cardCookieName(shop.id));
  const fromCard = current && isSecretId(current) ? await getCardBySecret(db, shop.id, current) : null;
  const r = await recoverCard(db, shop.id, card, fromCard);
  if (!r) return c.html(messagePage(t, "Please try again", "Something changed while we were restoring your card."), 409);
  setCardCookie(c, r.secretId);
  // card.js writes the new secret to localStorage on load.
  return c.redirect(`/card/${r.secretId}${r.merged ? `?merged=${r.merged}` : "?restored=1"}`, 303);
});

export default app;

// ── Views ──────────────────────────────────────────────────
function expiredPage(t: Theme) {
  return messagePage(t, "Link expired", "This link has expired or has already been used. Links only work once, for 15 minutes.", {
    href: "/recover",
    label: "Send a new link",
  });
}

function confirmPage(t: Theme, title: string, text: string, action: string, button: string) {
  return page({
    title,
    theme: t,
    body: html`<main class="wrap center">
      ${brandHeader(t)}
      <section class="panel">
        <h2 class="display">${title}</h2>
        <p>${text}</p>
        <form method="post" action="${action}">
          <button class="btn btn-primary btn-xl btn-block" type="submit">${button}</button>
        </form>
      </section>
    </main>`,
  });
}

function recoverPage(t: Theme, enabled: boolean, message?: string, isError = false) {
  return page({
    title: "Lost your card?",
    theme: t,
    body: html`<main class="wrap">
      ${brandHeader(t, "sm")}
      <section class="panel">
        <h2 class="display">Lost your card?</h2>
        ${enabled
          ? html`<p>If you saved your card to an email, enter it and we'll send you a link to get your stamps back.</p>
            ${message ? html`<div class="alert${isError ? "" : " ok"}" role="status">${message}</div>` : ""}
            <form method="post" action="/recover" class="stack">
              <label class="field">Email<input type="email" name="email" required autocomplete="email" inputmode="email"></label>
              <button class="btn btn-primary btn-block" type="submit">Send me a link</button>
            </form>`
          : html`<p>Card recovery by email isn't available here yet. Ask at the counter.</p>`}
      </section>
      <p class="center"><a href="/join">Back to my card</a></p>
    </main>`,
  });
}

