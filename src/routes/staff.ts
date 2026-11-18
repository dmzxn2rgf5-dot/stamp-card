import { Hono } from "hono";
import { createSession, destroySession, requireStaffApi, safeNext } from "../auth";
import { addStamps, cardState, getCardByScanCode, redeem, stampsToday, totals, undo, UNDO_WINDOW_MS } from "../db";
import { isId, isScanCode, isValidPin, newToken, verifyPin } from "../lib/crypto";
import { html, jsonData, raw } from "../lib/html";
import { MINUTE, clear, hit, peek } from "../lib/ratelimit";
import { startOfDay } from "../lib/time";
import { resolveTheme } from "../lib/theme";
import type { AppEnv, StaffRow } from "../types";
import { brandHeader, messagePage, page } from "../views/layout";

const app = new Hono<AppEnv>();
const theme = (c: { var: AppEnv["Variables"]; env: AppEnv["Bindings"] }) => resolveTheme(c.var.shop);

const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW = 15 * MINUTE;

function staffBar(staff: StaffRow) {
  return html`<div class="staff-bar">
    <a href="/staff">← Staff home</a>
    <span class="who">${staff.name}</span>
  </div>`;
}

// ── Login ──────────────────────────────────────────────────
app.get("/staff/login", async (c) => {
  const t = theme(c);
  const next = safeNext(c.req.query("next"));
  if (c.var.session) return c.redirect(next, 302);
  const { results } = await c.env.DB.prepare(`SELECT id, name FROM staff WHERE shop_id = ? AND active = 1 ORDER BY name`)
    .bind(c.var.shop.id)
    .all<{ id: string; name: string }>();
  if (!results.length) {
    return c.html(messagePage(t, "No staff yet", "The owner needs to finish setting up first using the setup link."));
  }
  return c.html(
    page({
      title: "Staff login",
      theme: t,
      body: html`<main class="wrap center">
        ${brandHeader(t, "sm")}
        <h2 class="display" style="color:var(--primary)">Who's working?</h2>
        <div class="names" id="names">
          ${results.map((s) => html`<button type="button" data-id="${s.id}" aria-pressed="false">${s.name}</button>`)}
        </div>
        <div id="pin-step" class="hidden">
          <p style="margin:18px 0 0;font-weight:700">Enter your PIN</p>
          <div class="pin-dots" id="dots" aria-live="polite"></div>
          <div class="alert hidden" id="err" role="alert"></div>
          <div class="keypad" id="keypad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" data-k="${n}">${n}</button>`)}
            <button type="button" data-k="del" aria-label="Delete">⌫</button>
            <button type="button" data-k="0">0</button>
            <button type="button" data-k="go" class="go">Go</button>
          </div>
        </div>
        ${jsonData("login-data", { next })}
      </main>`,
      scripts: ["/js/login.js"],
    }),
  );
});

app.post("/api/staff/login", async (c) => {
  const body = await c.req.json<{ staffId?: string; name?: string; pin?: string }>().catch(() => ({}) as Record<string, never>);
  const ip = c.req.header("CF-Connecting-IP") || "local";
  const db = c.env.DB;
  const shop = c.var.shop;

  let staff: StaffRow | null = null;
  if (isId(body.staffId)) {
    staff = await db.prepare(`SELECT * FROM staff WHERE id = ? AND shop_id = ? AND active = 1`).bind(body.staffId, shop.id).first<StaffRow>();
  } else if (typeof body.name === "string") {
    staff = await db.prepare(`SELECT * FROM staff WHERE name = ? AND shop_id = ? AND active = 1`).bind(body.name.trim(), shop.id).first<StaffRow>();
  }
  const ipKey = `login:ip:${ip}`;
  const staffKey = `login:staff:${staff?.id ?? "unknown"}`;
  if ((await peek(db, ipKey)) >= LOGIN_MAX_FAILS || (staff && (await peek(db, staffKey)) >= LOGIN_MAX_FAILS)) {
    return c.json({ ok: false, code: "RATE_LIMITED", message: "Too many wrong PINs. Try again in 15 minutes." }, 429);
  }
  const ok = !!staff && isValidPin(body.pin) && (await verifyPin(body.pin, staff.pin_hash));
  if (!ok || !staff) {
    await hit(db, ipKey, LOGIN_WINDOW);
    if (staff) await hit(db, staffKey, LOGIN_WINDOW);
    return c.json({ ok: false, code: "BAD_PIN", message: "That PIN didn't match. Try again." }, 401);
  }
  await clear(db, staffKey);
  await createSession(c, staff);
  return c.json({ ok: true, name: staff.name, role: staff.role });
});

app.post("/api/staff/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// ── Staff home ─────────────────────────────────────────────
app.get("/staff", async (c) => {
  const s = c.var.session;
  if (!s) return c.redirect(`/staff/login?next=${encodeURIComponent("/staff")}`, 302);
  const t = theme(c);
  const shop = c.var.shop;
  const today = startOfDay(shop.timezone);
  const [all, mine] = await Promise.all([totals(c.env.DB, shop.id, today), totals(c.env.DB, shop.id, today, s.staff.id)]);
  return c.html(
    page({
      title: "Staff",
      theme: t,
      body: html`<main class="wrap">
        ${brandHeader(t, "sm")}
        <div class="staff-bar"><span>Hi <b>${s.staff.name}</b></span>
          <button class="btn btn-sm btn-ghost" id="logout" type="button">Log out</button></div>
        <section class="panel center">
          <h2>Scan a card</h2>
          <a class="btn btn-primary btn-xl btn-block" href="/staff/scan">${raw(CAMERA_ICON)} Scan card</a>
          <p class="small muted" style="margin:12px 0 0">Or use your phone's normal camera app – the link it shows opens the stamp screen here too.</p>
        </section>
        <h3>Today</h3>
        <div class="stats">
          <div class="stat"><b>${all.stamps}</b><span>Stamps given</span></div>
          <div class="stat"><b>${all.rewards}</b><span>Rewards redeemed</span></div>
          <div class="stat"><b>${mine.stamps}</b><span>Stamps by you</span></div>
          <div class="stat"><b>${mine.rewards}</b><span>Rewards by you</span></div>
        </div>
        ${s.staff.role === "owner" ? html`<p class="center" style="margin-top:20px"><a class="btn btn-primary" href="/admin">Owner admin</a></p>` : ""}
      </main>`,
      scripts: ["/js/staff.js"],
    }),
  );
});

// ── In-app scanner ─────────────────────────────────────────
// The camera and QR decoding run entirely on the staff member's phone.
const CAMERA_ICON =
  '<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

app.get("/staff/scan", (c) => {
  const s = c.var.session;
  if (!s) return c.redirect(`/staff/login?next=${encodeURIComponent("/staff/scan")}`, 302);
  const t = theme(c);
  return c.html(
    page({
      title: "Scan card",
      theme: t,
      bodyClass: "scan-page",
      body: html`<main class="scanner">
        <video id="video" playsinline muted autoplay></video>
        <div class="scan-frame" aria-hidden="true"><span></span></div>
        <div class="scan-top">
          <a class="btn btn-sm" href="/staff">← Back</a>
          <span class="scan-who">${s.staff.name}</span>
        </div>
        <div class="scan-bottom">
          <p id="scan-status" role="status" aria-live="polite">Starting camera…</p>
          <form id="code-form" class="code-form hidden" autocomplete="off">
            <label class="sr-only" for="code">Card code</label>
            <input id="code" name="code" inputmode="text" autocapitalize="characters" maxlength="11" placeholder="Card code e.g. 3JTEE·JVRKC" spellcheck="false">
            <button class="btn btn-primary" type="submit">Go</button>
          </form>
          <button type="button" class="linkish scan-alt" id="show-code">Type the card code instead</button>
        </div>
      </main>`,
      scripts: ["/js/vendor/jsQR.js", "/js/scan.js"],
    }),
  );
});

// ── Stamp screen ───────────────────────────────────────────
app.get("/staff/stamp/:scanCode", async (c) => {
  const scanCode = c.req.param("scanCode").toUpperCase();
  const t = theme(c);
  const s = c.var.session;
  if (!s) {
    // Opening a link from the camera app can count as a cross-site
    // navigation, so a SameSite=Strict cookie isn't sent. Bounce once
    // through a same-origin navigation before falling back to login.
    const url = new URL(c.req.url);
    if (url.searchParams.get("r") !== "1") {
      c.header("Cache-Control", "no-store");
      return c.html(
        page({
          title: "Opening…",
          theme: t,
          body: html`<main class="wrap center"><p class="muted">Opening stamp screen…</p>
            ${jsonData("bounce-data", { to: `${url.pathname}?r=1` })}</main>`,
          scripts: ["/js/bounce.js"],
        }),
      );
    }
    return c.redirect(`/staff/login?next=${encodeURIComponent(url.pathname)}`, 302);
  }
  const shop = c.var.shop;
  const card = isScanCode(scanCode) ? await getCardByScanCode(c.env.DB, shop.id, scanCode) : null;
  if (!card) {
    return c.html(
      messagePage(t, "Card not found", "This QR code doesn't match a card. Ask the customer to refresh their card page and try again.", {
        href: "/staff",
        label: "Back",
      }),
      404,
    );
  }
  const st = cardState(card, shop);
  const today = await stampsToday(c.env.DB, shop, card.id);
  c.header("Cache-Control", "no-store");
  return c.html(
    page({
      title: "Stamp card",
      theme: t,
      body: html`<main class="wrap">
        ${staffBar(s.staff)}
        <section id="screen-stamp">
          <p class="center muted small" style="margin:0">Card ${card.scan_code.slice(0, 5)}·${card.scan_code.slice(5)}</p>
          <div class="big-count"><span id="count">${st.stamps}</span><small> / ${st.required}</small></div>
          ${st.rewardReady ? html`<div class="reward-banner">${shop.reward_label} ready</div>` : ""}
          <div class="alert hidden" id="err" role="alert"></div>

          ${st.rewardReady
            ? html`<div class="stack" style="margin-top:18px">
                <button class="btn btn-primary btn-xl btn-block" id="redeem" type="button">Redeem ${shop.reward_label.toLowerCase()}</button>
                <button class="btn btn-ghost btn-block" id="show-stamp" type="button">Add stamps instead</button>
              </div>`
            : ""}
          <div id="stamp-controls" class="${st.rewardReady ? "hidden" : ""}">
            <div class="stepper">
              <button type="button" id="minus" aria-label="One fewer">−</button>
              <output id="amount" aria-live="polite">1</output>
              <button type="button" id="plus" aria-label="One more">+</button>
            </div>
            <p class="stepper-label" id="amount-label">stamp</p>
            <button class="btn btn-primary btn-xl btn-block" id="confirm" type="button" style="margin-top:16px">Confirm</button>
          </div>
        </section>

        <section id="screen-done" class="hidden center">
          <div class="success-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
          <h2 class="display" id="done-title" style="color:var(--primary)">Done</h2>
          <div class="big-count"><span id="done-count"></span><small> / ${st.required}</small></div>
          <p id="done-note" class="muted"></p>
          <button class="btn btn-ghost btn-block" id="undo" type="button">Undo <span id="undo-timer"></span></button>
          <div class="alert hidden" id="undo-msg" role="status"></div>
        </section>

        <a class="btn btn-ghost btn-block" href="/staff/scan" style="margin-top:18px">${raw(CAMERA_ICON)} Scan next card</a>
        ${jsonData("stamp-data", {
          scanCode: card.scan_code,
          required: st.required,
          maxPerScan: shop.max_stamps_per_scan,
          leftToday: Math.max(0, shop.max_stamps_per_day - today),
          rewardLabel: shop.reward_label,
          idemKey: newToken(),
          undoWindowMs: UNDO_WINDOW_MS,
        })}
      </main>`,
      scripts: ["/js/api.js", "/js/stamp.js"],
    }),
  );
});

// ── Stamp / redeem / undo APIs ─────────────────────────────
const actionLimit = async (c: { env: AppEnv["Bindings"]; var: AppEnv["Variables"] }) => {
  const r = await hit(c.env.DB, `act:${c.var.session!.sessionId}`, MINUTE);
  return r.count > 30;
};

const tooMany = { ok: false, code: "RATE_LIMITED", message: "Too many requests. Wait a moment and try again." };

app.post("/api/staff/stamp", requireStaffApi, async (c) => {
  if (await actionLimit(c)) return c.json(tooMany, 429);
  const body = await c.req.json<{ scanCode?: string; amount?: number; idempotencyKey?: string }>().catch(() => ({}) as Record<string, never>);
  const scanCode = String(body.scanCode || "").toUpperCase();
  if (!isScanCode(scanCode)) return c.json({ ok: false, code: "NOT_FOUND", message: "Card not found." }, 404);
  const idem = isId(body.idempotencyKey) ? body.idempotencyKey : undefined;
  const r = await addStamps(c.env.DB, c.var.shop, c.var.session!.staff, scanCode, Number(body.amount ?? 1), idem);
  return r.ok ? c.json({ ok: true, eventId: r.eventId, ...r.state }) : c.json(r, r.status);
});

app.post("/api/staff/redeem", requireStaffApi, async (c) => {
  if (await actionLimit(c)) return c.json(tooMany, 429);
  const body = await c.req.json<{ scanCode?: string; idempotencyKey?: string }>().catch(() => ({}) as Record<string, never>);
  const scanCode = String(body.scanCode || "").toUpperCase();
  if (!isScanCode(scanCode)) return c.json({ ok: false, code: "NOT_FOUND", message: "Card not found." }, 404);
  const idem = isId(body.idempotencyKey) ? body.idempotencyKey : undefined;
  const r = await redeem(c.env.DB, c.var.shop, c.var.session!.staff, scanCode, idem);
  return r.ok ? c.json({ ok: true, eventId: r.eventId, ...r.state }) : c.json(r, r.status);
});

app.post("/api/staff/undo", requireStaffApi, async (c) => {
  if (await actionLimit(c)) return c.json(tooMany, 429);
  const body = await c.req.json<{ eventId?: string }>().catch(() => ({}) as Record<string, never>);
  if (!isId(body.eventId)) return c.json({ ok: false, code: "NOT_FOUND", message: "Nothing to undo." }, 404);
  const r = await undo(c.env.DB, c.var.shop, c.var.session!.staff, body.eventId);
  return r.ok ? c.json({ ok: true, eventId: r.eventId, ...r.state }) : c.json(r, r.status);
});

export default app;
