import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { cardCookieName, setCardCookie } from "../auth";
import { cardState, createCard, getCardBySecret } from "../db";
import { isSecretId } from "../lib/crypto";
import { html, jsonData, raw } from "../lib/html";
import { emailEnabled, maskEmail } from "../lib/email";
import { publicOrigin } from "../lib/url";
import { GET_IT_URL, PROJECT_NAME } from "../defaults";
import { broadcastForCard, broadcastPopup } from "./broadcasts";
import { qrSvg } from "../lib/qr";
import { HOUR, hit } from "../lib/ratelimit";
import { resolveTheme, stampSvg, type Theme } from "../lib/theme";
import type { AppEnv, CardRow, ShopRow } from "../types";
import { brandHeader, messagePage, page } from "../views/layout";

const app = new Hono<AppEnv>();
const theme = (c: { var: { shop: ShopRow } }) => resolveTheme(c.var.shop);

// ── /join ──────────────────────────────────────────────────
app.get("/join", async (c) => {
  const shop = c.var.shop;
  const db = c.env.DB;

  // 1. Cookie
  const fromCookie = getCookie(c, cardCookieName(shop.id));
  if (fromCookie && isSecretId(fromCookie) && (await getCardBySecret(db, shop.id, fromCookie))) {
    return c.redirect(`/card/${fromCookie}`, 302);
  }
  // 2. localStorage fallback (?ls=)
  const ls = c.req.query("ls");
  if (ls && isSecretId(ls) && (await getCardBySecret(db, shop.id, ls))) {
    setCardCookie(c, ls);
    return c.redirect(`/card/${ls}`, 302);
  }
  // 3. No cookie: let the browser check localStorage before we make a new card.
  if (c.req.query("new") !== "1" && !ls) {
    c.header("Cache-Control", "no-store");
    return c.html(
      page({
        title: `Your ${shop.name} card`,
        theme: theme(c),
        body: html`<main class="wrap center">${brandHeader(theme(c))}<p class="muted">Opening your card…</p>
          ${jsonData("join-data", { key: `sc_card_${shop.id}` })}</main>`,
        scripts: ["/js/join.js"],
      }),
    );
  }
  // 4. Create a new card (rate-limited per IP).
  const ip = c.req.header("CF-Connecting-IP") || "local";
  const limit = await hit(db, `join:${ip}`, HOUR);
  if (limit.count > 20) {
    return c.html(messagePage(theme(c), "Slow down", "Too many new cards from this connection. Please try again later."), 429);
  }
  const card = await createCard(db, shop.id);
  setCardCookie(c, card.secret_id);
  return c.redirect(`/card/${card.secret_id}`, 302);
});

// ── Card page ──────────────────────────────────────────────
app.get("/card/:secretId", async (c) => {
  const shop = c.var.shop;
  const t = theme(c);
  const secretId = c.req.param("secretId");
  const card = isSecretId(secretId) ? await getCardBySecret(c.env.DB, shop.id, secretId) : null;
  c.header("Cache-Control", "no-store");
  if (!card) {
    return c.html(
      messagePage(
        t,
        "Card not found",
        emailEnabled(c.env)
          ? "We couldn't find this card. If you saved it to your email, it may have been opened on another device – tap “Lost your card?” to get it back."
          : "We couldn't find this card. It may have been removed.",
        emailEnabled(c.env) ? { href: "/recover", label: "Lost your card?" } : { href: "/join?new=1", label: "Get a new card" },
      ),
      404,
    );
  }
  setCardCookie(c, card.secret_id); // refresh the 400-day cookie on every visit
  c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE cards SET last_seen_at = ? WHERE id = ?`).bind(Date.now(), card.id).run());
  const broadcast = await broadcastForCard(c.env.DB, shop.id, card.id);
  return c.html(cardPage(t, shop, card, emailEnabled(c.env), broadcast, c.req.query("merged") ? Number(c.req.query("merged")) || 0 : c.req.query("restored") ? 0 : null));
});

app.get("/api/card/:secretId", async (c) => {
  const shop = c.var.shop;
  const secretId = c.req.param("secretId");
  c.header("Cache-Control", "no-store");
  const card = isSecretId(secretId) ? await getCardBySecret(c.env.DB, shop.id, secretId) : null;
  if (!card) return c.json({ ok: false, code: "NOT_FOUND" }, 404);
  const since = c.req.query("since");
  if (since !== undefined) {
    // Polling: never carries broadcasts, so a new one only appears on the next open.
    if (Number(since) === card.version) return c.body(null, 204);
    return c.json(cardState(card, shop));
  }
  return c.json({ ...cardState(card, shop), broadcast: await broadcastForCard(c.env.DB, shop.id, card.id) });
});

app.get("/card/:secretId/qr.svg", async (c) => {
  const shop = c.var.shop;
  const secretId = c.req.param("secretId");
  const card = isSecretId(secretId) ? await getCardBySecret(c.env.DB, shop.id, secretId) : null;
  if (!card) return c.text("Not found", 404);
  const url = `${publicOrigin(c.env, c.req.url)}/staff/stamp/${card.scan_code}`;
  return c.body(qrSvg(url), 200, { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=86400" });
});

app.get("/card/:secretId/manifest.webmanifest", async (c) => {
  const secretId = c.req.param("secretId");
  if (!isSecretId(secretId)) return c.text("Not found", 404);
  const t = theme(c);
  return c.json(manifest(t, `/card/${secretId}`), 200, {
    "Content-Type": "application/manifest+json",
    "Cache-Control": "no-store",
  });
});

app.get("/manifest.webmanifest", (c) =>
  c.json(manifest(theme(c), "/join"), 200, { "Content-Type": "application/manifest+json" }),
);

app.get("/privacy", (c) => {
  const t = theme(c);
  const emailOn = emailEnabled(c.env);
  return c.html(
    page({
      title: "Privacy",
      theme: t,
      body: html`<main class="wrap">
        ${brandHeader(t, "sm")}
        <section class="panel">
          <h2>Privacy</h2>
          <p>Your ${t.name} loyalty card works without any personal information. We store a random card number, how many stamps you have, and when stamps were added (and by which member of staff).</p>
          ${emailOn ? html`<h3>If you save your card to an email</h3>
          <p>Adding an email is optional. We use it to send you sign-in links, so you can get your card back if you lose it or change phone. Each link works once, for 15 minutes.</p>
          <p>We only send you offers if you ticked “Send me occasional offers”. You can remove your email at any time from your card page, which also cancels offers. Your email is deleted if your card is deleted – just ask at the counter.</p>
          <p>The owner of ${t.name} can see saved emails so they can help you at the counter. Other staff can't.</p>` : ""}
          <h3>Cookies</h3>
          <p>We use one strictly necessary cookie so this browser remembers your card. There is no tracking and no advertising.</p>
          <p>${emailOn ? "If you haven't saved an email and you" : "If you"} clear your browser data or change phone, the card can't be recovered, because we don't know who you are.</p>
        </section>
        <p class="center"><a href="/join">Back to my card</a></p>
      </main>`,
    }),
  );
});

// Offline shell, cached by the service worker. Contains no card data.
app.get("/card-offline", (c) => c.html(cardPage(theme(c), c.var.shop, null)));

export default app;

// ── Views ──────────────────────────────────────────────────

function manifest(t: Theme, startUrl: string) {
  const icon = (src: string, size: string) => ({
    src,
    sizes: src.endsWith(".svg") ? "any" : `${size}x${size}`,
    type: src.endsWith(".svg") ? "image/svg+xml" : "image/png",
    purpose: "any",
  });
  return {
    name: `${t.name} card`,
    short_name: t.name.length > 12 ? t.name.split(" ")[0] : t.name,
    start_url: startUrl,
    scope: "/",
    display: "standalone",
    background_color: t.background,
    theme_color: t.primary,
    icons: [icon(t.icons["192"], "192"), icon(t.icons["512"], "512")],
  };
}

export function slotsHtml(t: Theme, stamps: number, required: number) {
  const cols = required <= 6 ? required : Math.ceil(required / 2);
  const art = raw(stampSvg(t.stampIcon, t.stampIconUrl));
  const slots = [];
  for (let i = 0; i < required; i++) {
    slots.push(html`<div class="slot${i < stamps ? " filled" : ""}" data-i="${i}">${art}<span class="num">${i + 1}</span></div>`);
  }
  return html`<div class="slots" id="slots" style="--cols:${cols}" role="img" aria-label="${Math.min(stamps, required)} of ${required} stamps">${slots}</div>`;
}

export function progressText(stamps: number, required: number, rewardLabel: string) {
  const left = required - stamps;
  if (left <= 0) return `${required} of ${required} – ${rewardLabel.toLowerCase()} ready!`;
  return `${stamps} of ${required} – ${left} more for a ${rewardLabel.toLowerCase()}`;
}

function cardPage(
  t: Theme,
  shop: ShopRow,
  card: CardRow | null,
  emailOn = false,
  broadcast: { id: string; message: string } | null = null,
  restored: number | null = null,
) {
  const emailStatus = !card?.email ? "none" : card.email_verified_at ? "verified" : "pending";
  // card === null renders the offline shell; card.js fills it from localStorage.
  const s = card ? cardState(card, shop) : cardState({ stamps: 0, version: -1, rewards_redeemed: 0 }, shop);
  return page({
    title: `${t.name} loyalty card`,
    theme: t,
    manifest: card ? `/card/${card.secret_id}/manifest.webmanifest` : undefined,
    body: html`<main class="wrap">
      ${brandHeader(t)}
      <section class="card-hero">
        ${t.tagline ? html`<p class="tagline">${t.tagline}</p>` : ""}
        ${slotsHtml(t, s.stamps, s.required)}
        <p class="progress" id="progress" aria-live="polite">${progressText(s.stamps, s.required, shop.reward_label)}
          ${s.stamps > s.required ? html`<small>+${s.stamps - s.required} carried over</small>` : ""}</p>
        <div class="reward-banner${s.rewardReady ? "" : " hidden"}" id="reward">${shop.reward_label} ready!</div>
      </section>

      <section class="qr-block">
        <div class="qr-frame"><img id="qr" src="${card ? `/card/${card.secret_id}/qr.svg` : ""}" alt="Your card QR code" width="240" height="240"></div>
        <p class="qr-caption">Show this at the counter</p>
        ${card ? html`<p class="card-code" aria-label="Card code">${card.scan_code.slice(0, 5)}·${card.scan_code.slice(5)}</p>` : ""}
        <p class="status-note muted" id="status"></p>
      </section>

      ${restored !== null
        ? html`<div class="alert ok" role="status">Welcome back – your card is restored${restored > 0 ? ` and ${restored} stamp${restored === 1 ? "" : "s"} from this browser ${restored === 1 ? "was" : "were"} added` : ""}.</div>`
        : ""}
      ${card && emailOn ? emailPanel(shop, card, emailStatus) : ""}

      <aside class="tip hidden" id="a2hs" role="note">
        <button class="close" type="button" aria-label="Dismiss" id="a2hs-close">×</button>
        <span id="a2hs-ios" class="hidden"><strong>Keep your card handy:</strong> tap the Share button <svg class="ico" viewBox="0 0 24 24" aria-label="Share" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1"/></svg> then <b>Add to Home Screen</b>.</span>
        <span id="a2hs-android" class="hidden"><strong>Keep your card handy:</strong> tap the <b>⋮</b> menu then <b>Add to Home screen</b>.
          <button class="btn btn-sm btn-primary hidden" id="a2hs-install" type="button">Add to Home screen</button></span>
      </aside>

      <footer class="foot">
        Your card lives in this browser. Bookmark this page or add it to your home screen so you don't lose it.<br>
        ${emailOn ? html`<a href="/recover">Lost your card?</a> · ` : ""}<a href="/privacy">Privacy</a>
      </footer>
      ${t.poweredBy ? html`<p class="powered-by">Powered by ${PROJECT_NAME} · <a href="${GET_IT_URL}" target="_blank" rel="noopener">Get it for your venue</a></p>` : ""}
      ${broadcast ? broadcastPopup(t, broadcast) : ""}
      ${jsonData("card-data", {
        secretId: card ? card.secret_id : null,
        emailOn,
        emailStatus,
        offline: !card,
        state: s,
        rewardLabel: shop.reward_label,
        storageKey: `sc_card_${shop.id}`,
      })}
    </main>`,
    scripts: ["/js/card.js"],
  });
}

function emailPanel(shop: ShopRow, card: CardRow, status: "none" | "pending" | "verified") {
  const masked = card.email ? maskEmail(card.email) : "";
  return html`<section class="save-card" id="save-card">
    <div id="email-none" class="${status === "none" && (card.stamps > 0 || card.rewards_redeemed > 0) ? "" : "hidden"}">
      <button type="button" class="linkish" id="email-open">Don't lose your stamps – save your card to your email</button>
      <form id="email-form" class="tip hidden" novalidate>
        <label class="field">Email<input type="email" name="email" required autocomplete="email" inputmode="email"></label>
        <label class="check"><input type="checkbox" name="optIn"> Send me occasional offers from ${shop.name}</label>
        <div class="alert hidden" id="email-err" role="alert"></div>
        <button class="btn btn-primary btn-block" type="submit">Save my card</button>
        <p class="small muted" style="margin:8px 0 0">We'll email you a link to confirm. No password, ever.</p>
      </form>
    </div>
    <p id="email-pending" class="small center ${status === "pending" ? "" : "hidden"}">
      Check your inbox to confirm <b data-masked>${status === "pending" ? masked : ""}</b> · <button type="button" class="linkish" data-remove>Remove</button>
    </p>
    <p id="email-verified" class="small center ${status === "verified" ? "" : "hidden"}">
      ✓ Saved to <b data-masked>${status === "verified" ? masked : ""}</b> · <button type="button" class="linkish" data-remove>Remove</button>
    </p>
  </section>`;
}
