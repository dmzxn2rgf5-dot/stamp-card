// Amendment 1 – owner-only Customers page. Baristas never reach any of this.
import { Hono, type MiddlewareHandler } from "hono";
import { requireOwnerApi } from "../auth";
import { adjustStamps, getCardById, logEvent } from "../db";
import { isId } from "../lib/crypto";
import { emailEnabled, emailFeatureOn, normaliseEmail } from "../lib/email";
import { html, jsonData } from "../lib/html";
import { DAY, localTime } from "../lib/time";
import { resolveTheme } from "../lib/theme";
import type { AppEnv, CardRow } from "../types";
import { brandHeader, messagePage, page } from "../views/layout";
import { emailRateOk, removeEmail, sendRecoveryLink, sendVerifyLink } from "./recovery";

const app = new Hono<AppEnv>();
const PAGE_SIZE = 50;

const ownerPage: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = c.var.session;
  if (!s) return c.redirect(`/staff/login?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 302);
  if (s.staff.role !== "owner")
    return c.html(messagePage(resolveTheme(c.var.shop), "Owners only", "Ask the owner to log in on this device.", { href: "/staff", label: "Back" }), 403);
  await next();
};
app.use("/admin/customers", ownerPage);
app.use("/admin/customers/*", ownerPage);
app.use("/api/admin/customers", requireOwnerApi);
app.use("/api/admin/customers/*", requireOwnerApi);
app.use("/api/admin/customers.csv", requireOwnerApi);

// ── Query ──────────────────────────────────────────────────
interface CustomerRow {
  id: string;
  scan_code: string;
  email: string | null;
  email_verified_at: number | null;
  stamps: number;
  rewards_redeemed: number;
  marketing_opt_in: number;
  marketing_opt_in_at: number | null;
  created_at: number;
  last_visit: number | null;
}

interface ListOpts {
  q?: string;
  optedIn?: boolean;
  rewardReady?: boolean;
  lapsed?: boolean;
  hasEmail?: boolean;
  sort?: string;
  page?: number;
  limit?: number | null;
}

async function listCustomers(db: D1Database, shopId: string, required: number, o: ListOpts) {
  const where: string[] = [];
  const binds: unknown[] = [shopId];
  if (o.q) {
    const like = `%${o.q.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    where.push(`(email LIKE ? ESCAPE '\\' OR scan_code LIKE ? ESCAPE '\\')`);
    binds.push(like.toLowerCase(), like.toUpperCase().replace(/[-·\s]/g, ""));
  }
  if (o.optedIn) where.push(`marketing_opt_in = 1 AND email_verified_at IS NOT NULL`);
  if (o.hasEmail) where.push(`email IS NOT NULL`);
  if (o.rewardReady) {
    where.push(`stamps >= ?`);
    binds.push(required);
  }
  if (o.lapsed) {
    where.push(`(last_visit IS NULL OR last_visit < ?)`);
    binds.push(Date.now() - 30 * DAY);
  }
  const order =
    o.sort === "stamps" ? "stamps DESC, last_visit DESC" : o.sort === "rewards" ? "rewards_redeemed DESC, last_visit DESC" : "last_visit IS NULL, last_visit DESC, created_at DESC";
  const inner = `SELECT c.id, c.scan_code, c.email, c.email_verified_at, c.stamps, c.rewards_redeemed, c.marketing_opt_in,
      c.marketing_opt_in_at, c.created_at,
      (SELECT MAX(e.created_at) FROM events e WHERE e.card_id = c.id AND e.type IN ('stamp','redeem')) AS last_visit
    FROM cards c WHERE c.shop_id = ? AND c.retired_at IS NULL`;
  const filtered = `SELECT * FROM (${inner}) ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM (${filtered})`).bind(...binds).first<{ n: number }>();
  const pageNo = Math.max(1, Math.floor(o.page || 1));
  const limit = o.limit === null ? -1 : PAGE_SIZE;
  const rows = await db
    .prepare(`${filtered} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .bind(...binds, limit, limit === -1 ? 0 : (pageNo - 1) * PAGE_SIZE)
    .all<CustomerRow>();
  return { total: total?.n ?? 0, page: pageNo, pageSize: PAGE_SIZE, rows: rows.results };
}

const optsFromQuery = (q: (k: string) => string | undefined): ListOpts => ({
  q: q("q")?.slice(0, 100),
  optedIn: q("optedIn") === "1",
  rewardReady: q("rewardReady") === "1",
  lapsed: q("lapsed") === "1",
  hasEmail: q("hasEmail") === "1",
  sort: q("sort"),
  page: Number(q("page")) || 1,
});

// ── Page ───────────────────────────────────────────────────
app.get("/admin/customers", (c) => {
  const t = resolveTheme(c.var.shop);
  const emailOn = emailFeatureOn(c.env);
  return c.html(
    page({
      title: "Customers",
      theme: t,
      body: html`<main class="wrap wide">
        <div class="staff-bar"><a href="/admin/">← Admin</a><span class="who">${c.var.session!.staff.name} (owner)</span></div>
        ${brandHeader(t, "sm")}
        <section class="panel">
          <h2>Customers</h2>

          <form id="filters" class="row" style="align-items:flex-end">
            <label class="field" style="flex:2 1 220px">${emailOn ? "Search email or card code" : "Search card code"}<input name="q" type="search" autocomplete="off"></label>
            <label class="field">Sort<select name="sort">
              <option value="lastVisit">Last visit</option><option value="stamps">Stamps</option><option value="rewards">Rewards</option>
            </select></label>
          </form>
          <div class="row" style="gap:16px;margin:-4px 0 12px">
            ${emailOn ? html`<label class="check" style="flex:0 0 auto"><input type="checkbox" form="filters" name="hasEmail" value="1"> Has email</label>
            <label class="check" style="flex:0 0 auto"><input type="checkbox" form="filters" name="optedIn" value="1"> Opted in to offers</label>` : ""}
            <label class="check" style="flex:0 0 auto"><input type="checkbox" form="filters" name="rewardReady" value="1"> Reward ready</label>
            <label class="check" style="flex:0 0 auto"><input type="checkbox" form="filters" name="lapsed" value="1"> No visit in 30+ days</label>
          </div>
          <div class="row" style="margin-bottom:12px">
            <a class="btn btn-sm" href="/api/admin/customers.csv">Export CSV</a>
            ${emailOn ? html`<a class="btn btn-sm" href="/api/admin/customers.csv?optedIn=1">Export opted-in only</a>` : ""}
            <span class="small muted" id="count" style="text-align:right"></span>
          </div>
          <div class="table-scroll"><table class="list">
            <thead><tr>${emailOn ? html`<th>Email</th>` : ""}<th>Stamps</th><th>Rewards</th>${emailOn ? html`<th>Offers</th>` : ""}<th>Card created</th><th>Last visit</th><th>Card</th></tr></thead>
            <tbody id="rows"><tr><td colspan="7" class="muted">Loading…</td></tr></tbody>
          </table></div>
          <div class="row" style="justify-content:center;margin-top:12px">
            <button class="btn btn-sm" id="prev" type="button" style="flex:0 0 auto">← Previous</button>
            <span id="pageinfo" class="small" style="flex:0 0 auto"></span>
            <button class="btn btn-sm" id="next" type="button" style="flex:0 0 auto">Next →</button>
          </div>
        </section>
        <div class="drawer hidden" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title"><div id="drawer-body"></div></div>
        ${jsonData("customers-data", { required: c.var.shop.stamps_required, tz: c.var.shop.timezone, emailOn, emailFeature: emailOn })}
      </main>`,
      scripts: ["/js/api.js", "/js/customers.js"],
    }),
  );
});

// ── API ────────────────────────────────────────────────────
app.get("/api/admin/customers", async (c) => {
  const shop = c.var.shop;
  const r = await listCustomers(c.env.DB, shop.id, shop.stamps_required, optsFromQuery((k) => c.req.query(k)));
  return c.json({ ok: true, required: shop.stamps_required, ...r });
});

app.get("/api/admin/customers.csv", async (c) => {
  const shop = c.var.shop;
  const optedInOnly = c.req.query("optedIn") === "1";
  const { rows } = await listCustomers(c.env.DB, shop.id, shop.stamps_required, { optedIn: optedInOnly, limit: null });
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const d = (ts: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : "");
  // Email columns only exist when email recovery is switched on.
  const withEmail = emailFeatureOn(c.env);
  const EMAIL_COLS = new Set([0, 1, 5, 6]);
  const keep = <T,>(row: T[]) => (withEmail ? row : row.filter((_, i) => !EMAIL_COLS.has(i)));
  const lines = [keep(["email", "email_status", "stamps", "stamps_required", "rewards_redeemed", "offers_opt_in", "opt_in_date", "card_created", "last_visit", "card_code"]).join(",")];
  for (const r of rows) {
    const verified = !!r.email_verified_at;
    const optIn = verified && r.marketing_opt_in === 1;
    lines.push(
      keep([r.email ?? "", r.email ? (verified ? "verified" : "pending") : "", r.stamps, shop.stamps_required, r.rewards_redeemed, optIn ? "yes" : "no", optIn ? d(r.marketing_opt_in_at) : "", d(r.created_at), d(r.last_visit), r.scan_code])
        .map(cell)
        .join(","),
    );
  }
  return c.body(lines.join("\n") + "\n", 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${shop.id}-customers${optedInOnly ? "-opted-in" : ""}-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "no-store",
  });
});

const EVENT_LABEL: Record<string, string> = {
  stamp: "Stamps added",
  redeem: "Reward redeemed",
  undo: "Undo",
  merge: "Stamps merged from another card",
  adjust: "Stamps adjusted",
  email_added: "Email added",
  email_removed: "Email removed",
  recovered: "Card restored by email",
  recovery_sent: "Recovery link sent",
  deleted: "Card deleted",
};

app.get("/api/admin/customers/:cardId", async (c) => {
  const shop = c.var.shop;
  const id = c.req.param("cardId");
  const card = isId(id) ? await getCardById(c.env.DB, shop.id, id) : null;
  if (!card) return c.json({ ok: false, message: "Customer not found." }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.type, e.amount, e.note, e.created_at, st.name AS staff,
       EXISTS (SELECT 1 FROM events u WHERE u.undoes_event_id = e.id) AS undone
     FROM events e LEFT JOIN staff st ON st.id = e.staff_id
     WHERE e.card_id = ? ORDER BY e.created_at DESC, e.rowid DESC LIMIT 200`,
  )
    .bind(card.id)
    .all<{ id: string; type: string; amount: number; note: string | null; created_at: number; staff: string | null; undone: number }>();
  return c.json({
    ok: true,
    customer: publicCustomer(card, shop.stamps_required),
    events: results.map((e) => ({
      ...e,
      label: EVENT_LABEL[e.type] ?? e.type,
      time: localTime(shop.timezone, e.created_at),
      staff: e.staff ?? (["merge", "recovered", "email_added", "email_removed"].includes(e.type) ? "Customer" : "—"),
    })),
  });
});

function publicCustomer(card: CardRow, required: number) {
  return {
    id: card.id,
    scanCode: card.scan_code,
    email: card.email,
    emailStatus: !card.email ? "none" : card.email_verified_at ? "verified" : "pending",
    stamps: card.stamps,
    required,
    rewardsRedeemed: card.rewards_redeemed,
    optIn: card.marketing_opt_in === 1,
    optInAt: card.marketing_opt_in_at,
    createdAt: card.created_at,
  };
}

app.patch("/api/admin/customers/:cardId", async (c) => {
  const shop = c.var.shop;
  const owner = c.var.session!.staff;
  const db = c.env.DB;
  const id = c.req.param("cardId");
  const card = isId(id) ? await getCardById(db, shop.id, id) : null;
  if (!card) return c.json({ ok: false, message: "Customer not found." }, 404);
  const b = await c.req.json<{ email?: string | null; adjust?: { amount?: number; reason?: string } }>().catch(() => ({}) as Record<string, never>);

  if (b.adjust) {
    const r = await adjustStamps(db, shop, owner, card.id, Number(b.adjust.amount), String(b.adjust.reason ?? ""));
    return r.ok ? c.json({ ok: true, ...r.state }) : c.json(r, r.status);
  }

  if (b.email === null || b.email === "") {
    await removeEmail(db, shop.id, card, owner.id);
    return c.json({ ok: true });
  }
  if (b.email !== undefined) {
    if (!emailFeatureOn(c.env)) return c.json({ ok: false, code: "NOT_FOUND" }, 404);
    if (!emailEnabled(c.env)) return c.json({ ok: false, message: "Email sending isn't set up yet." }, 503);
    const email = normaliseEmail(b.email);
    if (!email) return c.json({ ok: false, message: "That doesn't look like an email address." }, 400);
    if (email === card.email) return c.json({ ok: false, message: "That's already the email on this card." }, 400);
    if (!(await emailRateOk(db, email, null))) return c.json({ ok: false, message: "Too many emails to that address. Try again in an hour." }, 429);
    // A changed email must be confirmed by the customer before it can recover the card.
    await db.batch([
      db
        .prepare(`UPDATE cards SET email = ?, email_verified_at = NULL, marketing_opt_in = 0, marketing_opt_in_at = NULL WHERE id = ?`)
        .bind(email, card.id),
      db.prepare(`UPDATE email_tokens SET used_at = ? WHERE card_id = ? AND used_at IS NULL`).bind(Date.now(), card.id),
    ]);
    await logEvent(db, shop.id, card.id, owner.id, "email_added", "changed by owner – awaiting customer confirmation");
    const sent = await sendVerifyLink(c, card, email);
    return c.json({ ok: true, sent });
  }
  return c.json({ ok: false, message: "Nothing to change." }, 400);
});

app.post("/api/admin/customers/:cardId/send-recovery", async (c) => {
  const shop = c.var.shop;
  const db = c.env.DB;
  const id = c.req.param("cardId");
  const card = isId(id) ? await getCardById(db, shop.id, id) : null;
  if (!card) return c.json({ ok: false, message: "Customer not found." }, 404);
  if (!emailFeatureOn(c.env)) return c.json({ ok: false, code: "NOT_FOUND" }, 404);
  if (!emailEnabled(c.env)) return c.json({ ok: false, message: "Email sending isn't set up yet." }, 503);
  if (!card.email || !card.email_verified_at) return c.json({ ok: false, message: "This card has no confirmed email." }, 400);
  if (!(await emailRateOk(db, card.email, null))) return c.json({ ok: false, message: "Too many emails to that address. Try again in an hour." }, 429);
  const sent = await sendRecoveryLink(c, card);
  if (!sent) return c.json({ ok: false, message: "The email couldn't be sent." }, 502);
  await logEvent(db, shop.id, card.id, c.var.session!.staff.id, "recovery_sent");
  return c.json({ ok: true });
});

// Data deletion: the email and opt-in are erased and the card is retired
// (its link and QR stop working). The anonymous stamp history stays so
// shop totals and the audit log remain correct – it holds no personal data.
app.delete("/api/admin/customers/:cardId", async (c) => {
  const shop = c.var.shop;
  const db = c.env.DB;
  const id = c.req.param("cardId");
  const card = isId(id) ? await getCardById(db, shop.id, id) : null;
  if (!card) return c.json({ ok: false, message: "Customer not found." }, 404);
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE cards SET email = NULL, email_verified_at = NULL, marketing_opt_in = 0, marketing_opt_in_at = NULL,
           retired_at = ?, stamps = 0, version = version + 1 WHERE id = ?`,
      )
      .bind(now, card.id),
    db.prepare(`DELETE FROM email_tokens WHERE card_id = ?`).bind(card.id),
  ]);
  await logEvent(db, shop.id, card.id, c.var.session!.staff.id, "deleted", `had ${card.stamps} stamps`);
  return c.json({ ok: true });
});

export default app;
