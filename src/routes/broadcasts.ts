// Amendment 2 – broadcast offers shown as a pop-up on customers' cards.
import { Hono, type MiddlewareHandler } from "hono";
import { requireOwnerApi } from "../auth";
import { getCardBySecret } from "../db";
import { isId, isSecretId, newId } from "../lib/crypto";
import { html, jsonData, type Raw } from "../lib/html";
import { DAY, localTime, startOfDay } from "../lib/time";
import { WCAG_AA, contrastRatio, resolveTheme, type Theme } from "../lib/theme";
import type { AppEnv } from "../types";
import { brandHeader, messagePage, page } from "../views/layout";

const app = new Hono<AppEnv>();
export const MAX_MESSAGE = 280;

export interface BroadcastRow {
  id: string;
  shop_id: string;
  message: string;
  starts_at: number;
  ends_at: number | null;
  ended_at: number | null;
  created_by: string;
  created_at: number;
}

/** The shop's single newest broadcast that is live right now (never an older one). */
export async function newestActive(db: D1Database, shopId: string, now = Date.now()) {
  return db
    .prepare(
      `SELECT * FROM broadcasts
       WHERE shop_id = ?1 AND starts_at <= ?2 AND ended_at IS NULL AND (ends_at IS NULL OR ends_at > ?2)
       ORDER BY starts_at DESC, created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(shopId, now)
    .first<BroadcastRow>();
}

/** The broadcast to show this card, or null if it's already seen the newest one. */
export async function broadcastForCard(db: D1Database, shopId: string, cardId: string): Promise<{ id: string; message: string } | null> {
  const b = await newestActive(db, shopId);
  if (!b) return null;
  const seen = await db.prepare(`SELECT 1 FROM broadcast_views WHERE broadcast_id = ? AND card_id = ?`).bind(b.id, cardId).first();
  return seen ? null : { id: b.id, message: b.message };
}

/** Pop-up markup. The message is escaped by html``; CSS keeps line breaks. */
export function broadcastPopup(t: Theme, b: { id: string; message: string }, opts: { preview?: boolean } = {}): Raw {
  const card = html`<div class="bc-card" ${opts.preview ? "" : html`role="dialog" aria-modal="true" aria-labelledby="bc-msg"`}>
      <button type="button" class="bc-close" ${opts.preview ? html`tabindex="-1"` : html`id="bc-close"`} aria-label="Close">×</button>
      <img class="bc-logo" src="${t.logo}" alt="${t.name}" width="84" height="84">
      <p class="bc-message" ${opts.preview ? html`id="bc-preview-msg"` : html`id="bc-msg"`}>${b.message}</p>
    </div>`;
  if (opts.preview) return html`<div class="bc-preview" aria-label="Pop-up preview">${card}</div>`;
  return html`<div class="bc-overlay" id="bc" data-id="${b.id}">${card}</div>`;
}

// ── Customer: dismiss ──────────────────────────────────────
app.post("/api/card/:secretId/broadcast/:id/dismiss", async (c) => {
  const shop = c.var.shop;
  const secretId = c.req.param("secretId");
  const id = c.req.param("id");
  const card = isSecretId(secretId) ? await getCardBySecret(c.env.DB, shop.id, secretId) : null;
  if (!card) return c.json({ ok: false, code: "NOT_FOUND" }, 404);
  if (!isId(id)) return c.json({ ok: false, code: "NOT_FOUND" }, 404);
  // Safe to call twice; only records broadcasts that belong to this shop.
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO broadcast_views (broadcast_id, card_id, dismissed_at)
     SELECT id, ?, ? FROM broadcasts WHERE id = ? AND shop_id = ?`,
  )
    .bind(card.id, Date.now(), id, shop.id)
    .run();
  return c.json({ ok: true });
});

// ── Owner ──────────────────────────────────────────────────
const ownerPage: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.var.session;
  if (!s) return c.redirect(`/staff/login?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 302);
  if (s.staff.role !== "owner")
    return c.html(messagePage(resolveTheme(c.var.shop), "Owners only", "Ask the owner to log in on this device.", { href: "/staff", label: "Back" }), 403);
  await next();
};
app.use("/admin/broadcasts", ownerPage);
app.use("/api/admin/broadcasts", requireOwnerApi);
app.use("/api/admin/broadcasts/*", requireOwnerApi);

async function listBroadcasts(db: D1Database, shopId: string) {
  const { results } = await db
    .prepare(
      `SELECT b.*, st.name AS created_by_name, (SELECT COUNT(*) FROM broadcast_views v WHERE v.broadcast_id = b.id) AS seen
       FROM broadcasts b LEFT JOIN staff st ON st.id = b.created_by
       WHERE b.shop_id = ? ORDER BY b.starts_at DESC, b.created_at DESC, b.rowid DESC LIMIT 100`,
    )
    .bind(shopId)
    .all<BroadcastRow & { created_by_name: string | null; seen: number }>();
  const current = await newestActive(db, shopId);
  const now = Date.now();
  const status = (b: BroadcastRow) =>
    current?.id === b.id ? "live" : b.ended_at ? "ended" : b.ends_at && b.ends_at <= now ? "expired" : b.starts_at > now ? "scheduled" : "replaced";
  return {
    current: results.find((b) => b.id === current?.id) ?? null,
    history: results.filter((b) => b.id !== current?.id),
    status,
  };
}

app.get("/api/admin/broadcasts", async (c) => {
  const { current, history, status } = await listBroadcasts(c.env.DB, c.var.shop.id);
  const shape = (b: BroadcastRow & { seen: number; created_by_name: string | null }) => ({
    id: b.id,
    message: b.message,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    endedAt: b.ended_at,
    seen: b.seen,
    createdBy: b.created_by_name,
    status: status(b),
  });
  return c.json({ ok: true, current: current ? shape(current) : null, history: history.map(shape) });
});

app.post("/api/admin/broadcasts", async (c) => {
  const shop = c.var.shop;
  const body = await c.req.json<{ message?: string; endDate?: string | null }>().catch(() => ({}) as Record<string, never>);
  // Plain text only: normalise line endings, trim, cap blank lines.
  const message = String(body.message ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!message) return c.json({ ok: false, message: "Write a message first." }, 400);
  if ([...message].length > MAX_MESSAGE) return c.json({ ok: false, message: `Keep it to ${MAX_MESSAGE} characters.` }, 400);

  const now = Date.now();
  let endsAt: number | null = null;
  if (body.endDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) return c.json({ ok: false, message: "End date must be a date." }, 400);
    // Runs to the end of that day in the shop's time zone.
    const [y, m, d] = body.endDate.split("-").map(Number);
    const noonUtc = Date.UTC(y, m - 1, d, 12);
    endsAt = startOfDay(shop.timezone, noonUtc + DAY);
    if (endsAt <= now) return c.json({ ok: false, message: "The end date has already passed." }, 400);
  }
  const id = newId();
  const db = c.env.DB;
  // Publishing replaces the current broadcast.
  await db.batch([
    db.prepare(`UPDATE broadcasts SET ended_at = ? WHERE shop_id = ? AND ended_at IS NULL AND (ends_at IS NULL OR ends_at > ?)`).bind(now, shop.id, now),
    db
      .prepare(`INSERT INTO broadcasts (id, shop_id, message, starts_at, ends_at, ended_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(id, shop.id, message, now, endsAt, c.var.session!.staff.id, now),
  ]);
  return c.json({ ok: true, id });
});

app.post("/api/admin/broadcasts/:id/end", async (c) => {
  const id = c.req.param("id");
  if (!isId(id)) return c.json({ ok: false, message: "Broadcast not found." }, 404);
  const r = await c.env.DB.prepare(`UPDATE broadcasts SET ended_at = ? WHERE id = ? AND shop_id = ? AND ended_at IS NULL`)
    .bind(Date.now(), id, c.var.shop.id)
    .run();
  if (!r.meta.changes) return c.json({ ok: false, message: "That broadcast has already ended." }, 409);
  return c.json({ ok: true });
});

app.get("/admin/broadcasts", async (c) => {
  const shop = c.var.shop;
  const t = resolveTheme(shop);
  const { current, history, status } = await listBroadcasts(c.env.DB, shop.id);
  const ratio = contrastRatio(t.onPrimary, t.broadcastBg);
  const when = (ts: number | null) => (ts ? localTime(shop.timezone, ts) : "–");
  const endLabel = (b: BroadcastRow) => (b.ended_at ? `Ended ${when(b.ended_at)}` : b.ends_at ? `Ends ${when(b.ends_at)}` : "No end date");
  const today = new Date(Date.now()).toISOString().slice(0, 10);
  const STATUS: Record<string, string> = { live: "live", ended: "ended", expired: "expired", replaced: "replaced", scheduled: "scheduled" };

  return c.html(
    page({
      title: "Broadcasts",
      theme: t,
      body: html`<main class="wrap wide">
        <div class="staff-bar"><a href="/admin/">← Admin</a><span class="who">${c.var.session!.staff.name} (owner)</span></div>
        ${brandHeader(t, "sm")}

        <section class="panel">
          <h2>Current broadcast</h2>
          ${current
            ? html`<p class="bc-current" style="white-space:pre-line;font-weight:700;font-size:18px">${current.message}</p>
                <p class="small">Started ${when(current.starts_at)} · ${endLabel(current)} · <b>${current.seen}</b> card${current.seen === 1 ? " has" : "s have"} seen it</p>
                <button class="btn btn-sm btn-danger" type="button" id="end-now" data-id="${current.id}">End now</button>`
            : html`<p class="muted">Nothing is showing to customers right now.</p>`}
        </section>

        <div class="grid-2">
          <section class="panel">
            <h2>New broadcast</h2>
            <form id="bc-form">
              <label class="field">Message
                <textarea class="bc-input" name="message" maxlength="${MAX_MESSAGE}" required placeholder="e.g. Double stamps all weekend! ☕"></textarea>
              </label>
              <p class="small muted" style="margin:-6px 0 12px"><span id="bc-count">0</span> / ${MAX_MESSAGE} · plain text, line breaks are kept</p>
              <label class="field">End date (optional)<input type="date" name="endDate" min="${today}"></label>
              <p class="small muted" style="margin:-6px 0 12px">Leave blank to run until you post a new one or end it.</p>
              <div class="alert${ratio >= WCAG_AA ? " hidden" : ""}" role="status">
                Your text colour has low contrast on the pop-up background (${ratio.toFixed(1)}:1, needs 4.5:1). Fix it under
                <a href="/admin/#settings">Brand colours</a> so everyone can read the offer.
              </div>
              <div class="alert hidden" id="bc-err" role="alert"></div>
              <button class="btn btn-primary btn-block" type="submit">Publish</button>
            </form>
          </section>

          <section class="panel">
            <h2>Preview</h2>
            <p class="small muted">Exactly what customers see when they next open their card.</p>
            ${broadcastPopup(t, { id: "preview", message: "Your message will appear here." }, { preview: true })}
          </section>
        </div>

        <section class="panel">
          <h2>History</h2>
          <div class="table-scroll"><table class="list">
            <thead><tr><th>Message</th><th>Started</th><th>Ended</th><th>Seen by</th><th></th></tr></thead>
            <tbody>
              ${history.length
                ? history.map(
                    (b) => html`<tr>
                      <td style="white-space:pre-line;max-width:360px">${b.message}</td>
                      <td>${when(b.starts_at)}</td>
                      <td>${b.ended_at ? when(b.ended_at) : b.ends_at ? when(b.ends_at) : "–"}</td>
                      <td>${b.seen} card${b.seen === 1 ? "" : "s"}</td>
                      <td><span class="pill off">${STATUS[status(b)]}</span></td>
                    </tr>`,
                  )
                : html`<tr><td colspan="5" class="muted">No past broadcasts.</td></tr>`}
            </tbody>
          </table></div>
        </section>
        ${jsonData("bc-data", { max: MAX_MESSAGE, contrastOk: ratio >= WCAG_AA, ratio: Number(ratio.toFixed(1)) })}
      </main>`,
      scripts: ["/js/api.js", "/js/broadcasts.js"],
    }),
  );
});

export default app;
