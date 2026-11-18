import { Hono } from "hono";
import { createSession, requireOwnerApi } from "../auth";
import { totals } from "../db";
import { hashPin, isId, isValidPin, newId, sha256Hex } from "../lib/crypto";
import { html, jsonData, raw } from "../lib/html";
import { qrSvg } from "../lib/qr";
import { HOUR, hit } from "../lib/ratelimit";
import { DAY, localDate, localTime, startOfDay, startOfWeek } from "../lib/time";
import { HEX, STAMP_ICONS, WCAG_AA, contrastRatio, parseOverrides, resolveTheme, stampSvg, type ThemeOverrides } from "../lib/theme";
import { DEFAULTS, PROJECT_NAME, VENUE_PRESETS, VENUE_TYPES, type StampIcon, type VenueType } from "../defaults";
import { checkImage } from "../lib/images";
import { publicOrigin } from "../lib/url";
import type { AppEnv, StaffRow } from "../types";
import { brandHeader, messagePage, page } from "../views/layout";

const app = new Hono<AppEnv>();
const theme = (c: { var: AppEnv["Variables"]; env: AppEnv["Bindings"] }) => resolveTheme(c.var.shop);

// ── First-run owner setup ──────────────────────────────────
async function setupAllowed(c: { env: AppEnv["Bindings"]; var: AppEnv["Variables"] }, token: string | undefined) {
  if (!c.env.SETUP_TOKEN || !token) return false;
  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(c.env.SETUP_TOKEN)]);
  if (a !== b) return false;
  const owner = await c.env.DB.prepare(`SELECT 1 FROM staff WHERE shop_id = ? AND role = 'owner'`).bind(c.var.shop.id).first();
  return !owner;
}

app.get("/setup", async (c) => {
  const t = theme(c);
  const token = c.req.query("token");
  // 404 for everyone once an owner exists, and without the right token.
  if (!(await setupAllowed(c, token))) return c.html(messagePage(t, "Page not found", "That page doesn't exist."), 404);
  const shop = c.var.shop;
  const colourField = (name: string, label: string, value: string, hint: string) =>
    html`<label class="field">${label}<span class="small muted" style="display:block;font-weight:600">${hint}</span>
      <span class="colour-pair"><input type="color" name="${name}" value="${value}" aria-label="${label} picker"><input type="text" data-hex-for="${name}" value="${value.toUpperCase()}" maxlength="7" pattern="#[0-9A-Fa-f]{6}" aria-label="${label} hex" spellcheck="false" autocapitalize="characters"></span></label>`;
  const icons = STAMP_ICONS.map((i) => ({ id: i, svg: stampSvg(i) }));
  const steps = ["You", "Business", "Colours", "Rewards", "Done"];
  return c.html(
    page({
      title: `Set up ${PROJECT_NAME}`,
      theme: t,
      body: html`<main class="wrap">
        <header class="brand brand-sm"><img class="brand-logo" id="wiz-logo" src="${t.logo}" alt="" width="56" height="56"><h1 class="brand-name">Set up ${PROJECT_NAME}</h1></header>
        <ol class="wiz-steps" aria-label="Steps">${steps.map((n, i) => html`<li data-step-dot="${i + 1}" class="${i === 0 ? "on" : ""}">${n}</li>`)}</ol>
        <form id="wizard" data-token="${token}" novalidate>
          <section class="panel" data-step="1">
            <h2>Step 1 · Your owner account</h2>
            <p>You'll log in on any device with your name and PIN. You can add staff later.</p>
            <label class="field">Your name<input name="ownerName" required maxlength="40" autocomplete="name" placeholder="Owner"></label>
            <label class="field">PIN (4–6 digits)<input name="pin" required inputmode="numeric" pattern="\\d{4,6}" maxlength="6" autocomplete="new-password"></label>
            <label class="field">Type the PIN again<input name="pin2" required inputmode="numeric" pattern="\\d{4,6}" maxlength="6" autocomplete="new-password"></label>
          </section>
          <section class="panel hidden" data-step="2">
            <h2>Step 2 · Your business</h2>
            <label class="field">Business name<input name="shopName" required maxlength="60" placeholder="${shop.name}"></label>
            <label class="field">Type of venue<select name="venueType">
              ${VENUE_TYPES.map((v) => html`<option value="${v}">${VENUE_PRESETS[v].label}</option>`)}
            </select><span class="small muted" style="display:block">Only sets a starting stamp icon and reward. You can change both.</span></label>
            <label class="field">Logo (PNG, JPG, WebP or SVG, max 200 KB, optional)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
          </section>
          <section class="panel hidden" data-step="3">
            <h2>Step 3 · Colours</h2>
            ${colourField("primary", "Primary colour", t.primary, "Stamps, buttons, accents")}
            ${colourField("secondary", "Secondary colour", t.secondary, "Offer pop-up background, headings")}
            ${colourField("text", "Text colour", t.onPrimary, "Text on the two colours above")}
            <div class="alert hidden" id="contrast-warn" role="status">The text colour is hard to read on the pop-up background (needs 4.5:1 contrast). Try a lighter or darker text colour.</div>
            <h3 style="margin-top:14px">Preview</h3>
            <div class="wiz-preview" id="preview">
              <div class="wiz-card">
                <img class="wiz-card-logo" src="${t.logo}" alt="" data-logo-preview>
                <b class="wiz-card-name" data-name-preview>${shop.name}</b>
                <div class="slots" style="--cols:5" data-slots-preview>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => html`<div class="slot${i < 3 ? " filled" : ""}">${raw(stampSvg(t.stampIcon))}<span class="num">${i + 1}</span></div>`)}</div>
                <span class="btn btn-primary btn-sm">Button</span>
              </div>
              <div class="bc-preview"><div class="bc-card"><span class="bc-close" aria-hidden="true">×</span><img class="bc-logo" src="${t.logo}" alt="" data-logo-preview width="84" height="84"><p class="bc-message">2-for-1 on Fridays. Show this pop-up at the counter.</p></div></div>
            </div>
          </section>
          <section class="panel hidden" data-step="4">
            <h2>Step 4 · Rewards</h2>
            <label class="field">Stamps for a reward (3–20)<input type="number" name="stampsRequired" min="3" max="20" value="${shop.stamps_required}" required></label>
            <label class="field">Reward<input name="rewardLabel" maxlength="40" value="${shop.reward_label}" required></label>
            <fieldset class="field icon-pick"><legend>Stamp icon</legend>
              ${icons.map((i) => html`<label class="icon-opt"><input type="radio" name="stampIcon" value="${i.id}" ${i.id === t.stampIcon ? raw("checked") : ""}><span class="slot filled">${raw(i.svg)}</span><span class="small">${i.id}</span></label>`)}
            </fieldset>
            <p class="small muted">You can upload your own stamp icon later in Admin.</p>
          </section>
          <section class="panel hidden center" data-step="5">
            <h2>Step 5 · You're ready</h2>
            <p>Your loyalty card is set up. Print the counter poster so customers can scan it and get their card.</p>
            <p><a class="btn btn-primary btn-block" href="/admin/poster" target="_blank">Open the counter poster to print</a></p>
            <p><a class="btn btn-block" href="/admin/">Go to Admin</a></p>
            <p class="small muted">Staff log in at <b>/staff</b>. Add them in Admin → Staff.</p>
          </section>
          <div class="alert hidden" id="err" role="alert"></div>
          <div class="row wiz-nav" id="wiz-nav">
            <button class="btn btn-ghost" type="button" id="back" disabled>Back</button>
            <button class="btn btn-primary" type="submit" id="next">Next</button>
          </div>
        </form>
        ${jsonData("setup-data", { presets: VENUE_PRESETS, icons: Object.fromEntries(icons.map((i) => [i.id, i.svg])) })}
      </main>`,
      scripts: ["/js/api.js", "/js/setup.js"],
    }),
  );
});

app.post("/api/setup", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "local";
  if ((await hit(c.env.DB, `setup:${ip}`, HOUR)).count > 10) return c.json({ ok: false, message: "Too many attempts." }, 429);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (!(await setupAllowed(c, typeof b.token === "string" ? b.token : undefined))) return c.json({ ok: false, message: "Setup isn't available." }, 403);
  const name = String(b.ownerName ?? b.name ?? "").trim().slice(0, 40);
  if (!name) return c.json({ ok: false, message: "Enter your name." }, 400);
  if (!isValidPin(b.pin)) return c.json({ ok: false, message: "PIN must be 4–6 digits." }, 400);
  const shop = c.var.shop;
  // Business settings are all optional here: anything missing keeps its default.
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); vals.push(v); };
  if (typeof b.shopName === "string" && b.shopName.trim()) set("name", b.shopName.trim().slice(0, 60));
  const venue = typeof b.venueType === "string" && (VENUE_TYPES as string[]).includes(b.venueType) ? (b.venueType as VenueType) : null;
  const preset = venue ? VENUE_PRESETS[venue] : null;
  const reward = typeof b.rewardLabel === "string" && b.rewardLabel.trim() ? b.rewardLabel.trim().slice(0, 40) : preset?.rewardLabel;
  if (reward) set("reward_label", reward);
  if (b.stampsRequired !== undefined) set("stamps_required", clampInt(b.stampsRequired, 3, 20, shop.stamps_required));
  for (const [key, col] of [["primary", "primary_colour"], ["secondary", "secondary_colour"], ["text", "text_colour"]] as const) {
    const v = b[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !HEX.test(v)) return c.json({ ok: false, message: `The ${key} colour must be a hex colour like #2F6FED.` }, 400);
    set(col, v.toUpperCase());
  }
  const o: ThemeOverrides = parseOverrides(shop.theme);
  if (venue) o.venueType = venue;
  const icon = typeof b.stampIcon === "string" && (STAMP_ICONS as string[]).includes(b.stampIcon) ? (b.stampIcon as StampIcon) : preset?.stampIcon;
  if (icon) o.stampIcon = icon;
  set("theme", JSON.stringify(o));

  const staff: StaffRow = { id: newId(), shop_id: shop.id, name, pin_hash: await hashPin(b.pin), role: "owner", active: 1, created_at: Date.now() };
  vals.push(shop.id);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO staff (id, shop_id, name, pin_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .bind(staff.id, staff.shop_id, staff.name, staff.pin_hash, staff.role, staff.created_at),
    c.env.DB.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE id = ?`).bind(...vals),
  ]);
  await createSession(c, staff);
  return c.json({ ok: true });
});

// ── Owner guard for pages ──────────────────────────────────
app.use("/admin/*", async (c, next) => {
  const s = c.var.session;
  if (!s) return c.redirect(`/staff/login?next=${encodeURIComponent(new URL(c.req.url).pathname)}`, 302);
  if (s.staff.role !== "owner") return c.html(messagePage(theme(c), "Owners only", "Ask the owner to log in on this device.", { href: "/staff", label: "Back" }), 403);
  await next();
});
app.get("/admin", (c) => c.redirect("/admin/", 301));
app.use("/api/admin/*", requireOwnerApi);

// ── Admin page ─────────────────────────────────────────────
app.get("/admin/", async (c) => {
  const shop = c.var.shop;
  const t = theme(c);
  const o = parseOverrides(shop.theme);
  const db = c.env.DB;
  const now = Date.now();
  const [staff, sessions, recent, stats] = await Promise.all([
    db.prepare(`SELECT * FROM staff WHERE shop_id = ? ORDER BY active DESC, role DESC, name`).bind(shop.id).all<StaffRow>(),
    db
      .prepare(
        `SELECT s.id, s.created_at, s.last_used_at, s.user_agent, st.name, st.id AS staff_id FROM sessions s JOIN staff st ON st.id = s.staff_id
         WHERE st.shop_id = ? AND s.expires_at > ? ORDER BY s.last_used_at DESC`,
      )
      .bind(shop.id, now)
      .all<{ id: string; created_at: number; last_used_at: number | null; user_agent: string; name: string; staff_id: string }>(),
    db
      .prepare(
        `SELECT e.id, e.type, e.amount, e.created_at, COALESCE(st.name, 'Customer') AS name, c.scan_code,
           EXISTS (SELECT 1 FROM events u WHERE u.undoes_event_id = e.id) AS undone
         FROM events e LEFT JOIN staff st ON st.id = e.staff_id JOIN cards c ON c.id = e.card_id
         WHERE e.shop_id = ? ORDER BY e.created_at DESC LIMIT 50`,
      )
      .bind(shop.id)
      .all<{ id: string; type: string; amount: number; created_at: number; name: string; scan_code: string; undone: number }>(),
    getStats(db, shop.id, shop.timezone),
  ]);
  const me = c.var.session!;
  // Colour picker + hex field, kept in sync by admin.js.
  const colourField = (name: string, label: string, value: string, hint?: string) =>
    html`<label class="field">${label}${hint ? html`<span class="small muted" style="display:block;font-weight:600">${hint}</span>` : ""}
      <span class="colour-pair"><input type="color" name="${name}" value="${value}" aria-label="${label} picker"><input type="text" data-hex-for="${name}" value="${value.toUpperCase()}" maxlength="7" pattern="#[0-9A-Fa-f]{6}" aria-label="${label} hex" spellcheck="false" autocapitalize="characters"></span></label>`;
  const contrastOk = contrastRatio(t.onPrimary, t.broadcastBg) >= WCAG_AA;
  const maxBar = Math.max(1, ...stats.perDay.map((d) => d.stamps));

  return c.html(
    page({
      title: "Admin",
      theme: t,
      body: html`<main class="wrap wide">
        <div class="staff-bar"><a href="/staff">← Staff home</a><span class="who">${me.staff.name} (owner)</span></div>
        ${brandHeader(t, "sm")}
        <nav class="tabs">
          <a class="btn btn-sm" href="#stats">Stats</a>
          <a class="btn btn-sm" href="#settings">Settings &amp; brand</a>
          <a class="btn btn-sm" href="#staff">Staff</a>
          <a class="btn btn-sm" href="#activity">Activity</a>
          <a class="btn btn-sm btn-primary" href="/admin/customers">Customers</a>
          <a class="btn btn-sm btn-primary" href="/admin/broadcasts">Broadcasts</a>
          <a class="btn btn-sm btn-primary" href="/admin/poster" target="_blank">Counter poster</a>
          <a class="btn btn-sm" href="/api/admin/export.csv">Export CSV</a>
        </nav>

        <section class="panel" id="stats">
          <h2>Stats</h2>
          <div class="stats">
            <div class="stat"><b>${stats.today.stamps}</b><span>Stamps today</span></div>
            <div class="stat"><b>${stats.today.rewards}</b><span>Rewards today</span></div>
            <div class="stat"><b>${stats.week.stamps}</b><span>Stamps this week</span></div>
            <div class="stat"><b>${stats.week.rewards}</b><span>Rewards this week</span></div>
            <div class="stat"><b>${stats.all.stamps}</b><span>Stamps all time</span></div>
            <div class="stat"><b>${stats.all.rewards}</b><span>Rewards all time</span></div>
            <div class="stat"><b>${stats.activeCards}</b><span>Active cards (30 days)</span></div>
            <div class="stat"><b>${stats.totalCards}</b><span>Cards issued</span></div>
          </div>
          <h3 style="margin-top:18px">Stamps per day (last 14 days)</h3>
          <div class="bars" role="img" aria-label="Stamps per day">
            ${stats.perDay.map((d) => html`<div style="height:${Math.round((d.stamps / maxBar) * 100)}%" title="${d.date}: ${d.stamps} stamps, ${d.rewards} rewards"></div>`)}
          </div>
          <div class="bars-labels">${stats.perDay.map((d) => html`<span>${d.date.slice(8)}</span>`)}</div>
        </section>

        <div class="grid-2">
          <section class="panel" id="settings">
            <h2>Loyalty rules</h2>
            <form id="rules-form">
              <label class="field">Shop name<input name="name" value="${shop.name}" maxlength="60" required></label>
              <label class="field">Reward label<input name="rewardLabel" value="${shop.reward_label}" maxlength="40" required></label>
              <div class="row">
                <label class="field">Stamps for a reward<input type="number" name="stampsRequired" min="3" max="20" value="${shop.stamps_required}"></label>
                <label class="field">Max per scan<input type="number" name="maxStampsPerScan" min="1" max="10" value="${shop.max_stamps_per_scan}"></label>
                <label class="field">Max per card per day<input type="number" name="maxStampsPerDay" min="1" max="50" value="${shop.max_stamps_per_day}"></label>
              </div>
              <button class="btn btn-primary" type="submit">Save rules</button>
              <span class="small muted" data-msg></span>
            </form>
          </section>

          <section class="panel">
            <h2>Brand</h2>
            <form id="brand-form">
              <h3>Brand colours</h3>
              ${colourField("primary", "Primary colour", t.primary, "Filled stamps, buttons, accents")}
              ${colourField("secondary", "Secondary colour", t.secondary, "Broadcast pop-up background, headings")}
              ${colourField("text", "Text colour", t.onPrimary, "Text on brand-coloured backgrounds, including the pop-up")}
              <label class="field">Broadcast background<select name="broadcastBg">
                <option value="secondary" ${t.broadcastBgSetting === "secondary" ? raw("selected") : ""}>Secondary colour</option>
                <option value="primary" ${t.broadcastBgSetting === "primary" ? raw("selected") : ""}>Primary colour</option>
              </select></label>
              <div class="alert${contrastOk ? " hidden" : ""}" id="contrast-warn" role="status">
                The text colour doesn't have enough contrast against the pop-up background (needs 4.5:1, WCAG AA). Customers may struggle to read offers.
              </div>
              <h3 style="margin-top:16px">More colours</h3>
              <div class="row">
                ${colourField("accent", "Accent", t.accent)}
                ${colourField("ink", "Page text", t.ink)}
              </div>
              <div class="row">
                ${colourField("background", "Background", t.background)}
                ${colourField("surface", "Panels", t.surface)}
              </div>
              <div class="row">
                <label class="field">Stamp icon<select name="stampIcon">
                  ${STAMP_ICONS.map((i) => html`<option value="${i}" ${i === t.stampIcon ? raw("selected") : ""}>${i}</option>`)}
                  ${o.stampIconVersion ? html`<option value="custom" ${t.stampIcon === "custom" ? raw("selected") : ""}>my uploaded icon</option>` : ""}
                </select></label>
              </div>
              <div class="preview-slots" aria-label="Stamp preview">
                ${[0, 1, 2].map(() => html`<div class="slot filled" style="background:#fff">${raw(stampSvg(t.stampIcon, t.stampIconUrl))}</div>`)}
              </div>
              <label class="field" style="margin-top:12px">Tagline<input name="tagline" value="${t.tagline}" maxlength="80"></label>
              <label class="field">Heading font (CSS)<input name="fontDisplay" value="${o.fontDisplay ?? ""}" placeholder="${DEFAULTS.fonts.display}"></label>
              <label class="field">Body font (CSS)<input name="fontBody" value="${o.fontBody ?? ""}" placeholder="${DEFAULTS.fonts.body}"></label>
              <label class="field">Google Fonts URL (optional)<input name="fontsUrl" value="${o.fontsUrl ?? ""}" placeholder="https://fonts.googleapis.com/css2?family=…"></label>
              <label class="field"><input type="checkbox" name="showNameWithLogo" ${t.showNameWithLogo ? raw("checked") : ""} style="display:inline;width:auto;min-height:0"> Show shop name under the logo</label>
              <label class="field"><input type="checkbox" name="poweredBy" ${t.poweredBy ? raw("checked") : ""} style="display:inline;width:auto;min-height:0"> Show “Powered by ${PROJECT_NAME} · Get it for your venue” at the bottom of the card (also turns the enquiry form on or off)</label>
              <div class="row">
                <button class="btn btn-primary" type="submit">Save brand</button>
                <button class="btn btn-ghost" type="button" id="brand-reset">Reset to defaults</button>
              </div>
              <span class="small muted" data-msg></span>
            </form>
            <hr style="border:0;border-top:1px solid rgba(0,0,0,.1);margin:18px 0">
            <h3>Logo</h3>
            <div class="row" style="align-items:flex-start">
              <img src="${t.logo}" alt="Current logo" width="80" height="80" style="flex:0 0 80px;border-radius:16px;object-fit:contain;background:#fff">
              <form id="logo-form" style="flex:1 1 200px">
                <label class="field">Upload PNG, JPEG, WebP or SVG (max 200 KB)<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
                <label class="field">…or logo URL<input name="url" value="${c.var.shop.logo_url?.startsWith("/logo") ? "" : (c.var.shop.logo_url ?? "")}" placeholder="https://…"></label>
                <button class="btn btn-primary btn-sm" type="submit">Save logo</button>
                <span class="small muted" data-msg></span>
              </form>
            </div>
            <h3 style="margin-top:16px">Your own stamp icon</h3>
            <form id="stamp-icon-form">
              <label class="field">Square PNG, WebP or SVG works best (max 200 KB)<input type="file" name="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>
              <button class="btn btn-primary btn-sm" type="submit">Upload and use</button>
              <span class="small muted" data-msg></span>
            </form>
          </section>
        </div>

        <section class="panel" id="staff">
          <h2>Staff</h2>
          <div class="table-scroll"><table class="list">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
            <tbody>
            ${staff.results.map(
              (s) => html`<tr data-id="${s.id}" data-name="${s.name}">
                <td><b>${s.name}</b></td>
                <td>${s.role === "owner" ? "Owner" : "Staff"}</td>
                <td>${s.active ? html`<span class="pill">active</span>` : html`<span class="pill off">off</span>`}</td>
                <td><div class="actions">
                  <button class="btn btn-sm" data-act="rename">Rename</button>
                  <button class="btn btn-sm" data-act="reset_pin">Reset PIN</button>
                  ${s.id === me.staff.id
                    ? ""
                    : s.active
                      ? html`<button class="btn btn-sm btn-danger" data-act="deactivate">Deactivate</button>`
                      : html`<button class="btn btn-sm" data-act="reactivate">Reactivate</button>`}
                </div></td>
              </tr>`,
            )}
            </tbody>
          </table></div>
          <h3 style="margin-top:16px">Add staff</h3>
          <form id="add-staff" class="row">
            <label class="field">Name<input name="name" required maxlength="40"></label>
            <label class="field">PIN<input name="pin" required inputmode="numeric" pattern="\\d{4,6}" maxlength="6"></label>
            <label class="field">Role<select name="role"><option value="barista">Staff</option><option value="owner">Owner</option></select></label>
            <button class="btn btn-primary" type="submit" style="flex:0 0 auto">Add</button>
            <span class="small muted" data-msg></span>
          </form>

          <h3 style="margin-top:16px">Logged-in devices</h3>
          <div class="table-scroll"><table class="list">
            <thead><tr><th>Who</th><th>Since</th><th>Last used</th><th>Device</th><th></th></tr></thead>
            <tbody>
            ${sessions.results.map(
              (s) => html`<tr>
                <td>${s.name}${s.id === me.sessionId ? html` <span class="pill">this device</span>` : ""}</td>
                <td>${localTime(shop.timezone, s.created_at)}</td>
                <td>${s.last_used_at ? localTime(shop.timezone, s.last_used_at) : "–"}</td>
                <td class="small muted">${deviceName(s.user_agent)}</td>
                <td>${s.id === me.sessionId ? "" : html`<button class="btn btn-sm" data-revoke="${s.id}">Log out</button>`}</td>
              </tr>`,
            )}
            </tbody>
          </table></div>
        </section>

        <section class="panel" id="activity">
          <h2>Recent activity</h2>
          <div class="table-scroll"><table class="list">
            <thead><tr><th>Time</th><th>What</th><th>Staff</th><th>Card</th></tr></thead>
            <tbody>
            ${recent.results.map(
              (e) => html`<tr style="${e.undone ? "opacity:.5;text-decoration:line-through" : ""}">
                <td>${localTime(shop.timezone, e.created_at)}</td>
                <td>${activityLabel(e.type, e.amount)}</td>
                <td>${e.name}</td>
                <td><code>${e.scan_code}</code></td>
              </tr>`,
            )}
            ${recent.results.length ? "" : html`<tr><td colspan="4" class="muted">Nothing yet.</td></tr>`}
            </tbody>
          </table></div>
        </section>
      </main>`,
      scripts: ["/js/api.js", "/js/admin.js"],
    }),
  );
});

function activityLabel(type: string, amount: number) {
  switch (type) {
    case "stamp": return `+${amount} stamp${amount === 1 ? "" : "s"}`;
    case "redeem": return "Reward redeemed";
    case "undo": return "Undo";
    case "merge": return `+${amount} merged from old card`;
    case "adjust": return `Adjusted ${amount > 0 ? "+" : ""}${amount}`;
    case "email_added": return "Email added";
    case "email_removed": return "Email removed";
    case "recovered": return "Card restored by email";
    case "recovery_sent": return "Recovery link sent";
    case "deleted": return "Card deleted";
    default: return type;
  }
}

function deviceName(ua: string) {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}

// ── Poster ─────────────────────────────────────────────────
app.get("/admin/poster", (c) => {
  const t = theme(c);
  const joinUrl = `${publicOrigin(c.env, c.req.url)}/join`;
  return c.html(
    page({
      title: `${t.name} – counter poster`,
      theme: t,
      body: html`<div class="print-bar"><button class="btn btn-primary" id="print" type="button">Print (A5)</button></div>
      <div class="poster">
        <div class="band"></div>
        <div>
          <img class="brand-logo" src="${t.logo}" alt="${t.name}">
          <h1>Scan for your loyalty card</h1>
          <p class="sub">${t.tagline}</p>
          <div class="qr-frame">${raw(qrSvg(joinUrl, { title: "Scan to get your loyalty card" }))}</div>
          <ol>
            <li>Point your phone camera at the code</li>
            <li>Your card opens – no app, no sign-up</li>
            <li>Show it at the till to collect stamps</li>
          </ol>
        </div>
        <div class="band"></div>
      </div>`,
      scripts: ["/js/poster.js"],
    }),
  );
});

// ── Admin APIs ─────────────────────────────────────────────
const clampInt = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const cleanFont = (v: unknown) => (typeof v === "string" ? v.replace(/[;{}<>]/g, "").slice(0, 120).trim() : "");

app.patch("/api/admin/shop", async (c) => {
  const shop = c.var.shop;
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };

  if (typeof b.name === "string" && b.name.trim()) set("name", b.name.trim().slice(0, 60));
  if (typeof b.rewardLabel === "string" && b.rewardLabel.trim()) set("reward_label", b.rewardLabel.trim().slice(0, 40));
  if (b.stampsRequired !== undefined) set("stamps_required", clampInt(b.stampsRequired, 3, 20, shop.stamps_required));
  if (b.maxStampsPerScan !== undefined) set("max_stamps_per_scan", clampInt(b.maxStampsPerScan, 1, 10, shop.max_stamps_per_scan));
  if (b.maxStampsPerDay !== undefined) set("max_stamps_per_day", clampInt(b.maxStampsPerDay, 1, 50, shop.max_stamps_per_day));
  for (const [key, col, label] of [
    ["primary", "primary_colour", "Primary"],
    ["secondary", "secondary_colour", "Secondary"],
    ["text", "text_colour", "Text"],
  ] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "string" || !HEX.test(b[key] as string)) return c.json({ ok: false, message: `${label} colour must be a hex colour like #2F6FED.` }, 400);
    set(col, (b[key] as string).toUpperCase());
  }
  if (b.broadcastBg !== undefined) {
    if (b.broadcastBg !== "primary" && b.broadcastBg !== "secondary") return c.json({ ok: false, message: "Broadcast background must be primary or secondary." }, 400);
    set("broadcast_bg", b.broadcastBg);
  }
  if (b.reset === true) {
    // Back to the neutral defaults (shop name, rules and uploaded files are kept).
    set("primary_colour", DEFAULTS.colours.primary);
    set("secondary_colour", DEFAULTS.colours.secondary);
    set("text_colour", DEFAULTS.colours.text);
    set("broadcast_bg", "secondary");
    set("brand_colour", null);
    set("logo_url", null);
    const keep = parseOverrides(shop.theme);
    set("theme", JSON.stringify({ venueType: keep.venueType, stampIconVersion: keep.stampIconVersion }));
  }
  if (b.logoUrl !== undefined) {
    const u = b.logoUrl;
    if (u !== null && (typeof u !== "string" || !(/^https:\/\/[^\s"'<>]+$/.test(u) || /^\/[\w\-./?=]+$/.test(u))))
      return c.json({ ok: false, message: "Logo URL must start with https:// or /." }, 400);
    set("logo_url", u || null);
  }
  if (b.theme !== undefined) {
    if (b.theme === null) set("theme", "{}");
    else if (typeof b.theme === "object") {
      const t = b.theme as Record<string, unknown>;
      // Keep settings that aren't edited on this form.
      const prev = parseOverrides(shop.theme);
      const o: ThemeOverrides = { venueType: prev.venueType, stampIconVersion: prev.stampIconVersion };
      for (const k of ["accent", "ink", "background", "surface"] as const) {
        if (t[k] !== undefined && t[k] !== "") {
          if (typeof t[k] !== "string" || !HEX.test(t[k] as string)) return c.json({ ok: false, message: `${k} must be a hex colour.` }, 400);
          o[k] = t[k] as string;
        }
      }
      if (typeof t.stampIcon === "string" && ((STAMP_ICONS as string[]).includes(t.stampIcon) || (t.stampIcon === "custom" && prev.stampIconVersion))) o.stampIcon = t.stampIcon as StampIcon;
      if (typeof t.tagline === "string") o.tagline = t.tagline.slice(0, 80);
      if (cleanFont(t.fontDisplay)) o.fontDisplay = cleanFont(t.fontDisplay);
      if (cleanFont(t.fontBody)) o.fontBody = cleanFont(t.fontBody);
      if (typeof t.fontsUrl === "string" && t.fontsUrl) {
        if (!/^https:\/\/fonts\.googleapis\.com\/[^\s"'<>]+$/.test(t.fontsUrl)) return c.json({ ok: false, message: "Fonts URL must be a Google Fonts link." }, 400);
        o.fontsUrl = t.fontsUrl;
      }
      if (typeof t.showNameWithLogo === "boolean") o.showNameWithLogo = t.showNameWithLogo;
      if (typeof t.poweredBy === "boolean") o.poweredBy = t.poweredBy;
      set("theme", JSON.stringify(o));
    }
  }
  if (!sets.length) return c.json({ ok: false, message: "Nothing to change." }, 400);
  vals.push(shop.id);
  await c.env.DB.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return c.json({ ok: true });
});

async function uploadedImage(c: { req: { formData(): Promise<FormData> } }) {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return { error: "Choose an image file." } as const;
  const error = await checkImage(file);
  return error ? ({ error } as const) : ({ file } as const);
}

app.post("/api/admin/logo", async (c) => {
  const up = await uploadedImage(c);
  if ("error" in up) return c.json({ ok: false, message: up.error }, 400);
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO shop_logos (shop_id, content_type, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(c.var.shop.id, up.file.type, await up.file.arrayBuffer(), now),
    c.env.DB.prepare(`UPDATE shops SET logo_url = ? WHERE id = ?`).bind(`/logo?v=${now}`, c.var.shop.id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/admin/stamp-icon", async (c) => {
  const up = await uploadedImage(c);
  if ("error" in up) return c.json({ ok: false, message: up.error }, 400);
  const now = Date.now();
  const o = parseOverrides(c.var.shop.theme);
  o.stampIcon = "custom";
  o.stampIconVersion = now;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO shop_stamp_icons (shop_id, content_type, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(shop_id) DO UPDATE SET content_type = excluded.content_type, data = excluded.data, updated_at = excluded.updated_at`,
    ).bind(c.var.shop.id, up.file.type, await up.file.arrayBuffer(), now),
    c.env.DB.prepare(`UPDATE shops SET theme = ? WHERE id = ?`).bind(JSON.stringify(o), c.var.shop.id),
  ]);
  return c.json({ ok: true });
});

app.post("/api/admin/staff", async (c) => {
  const shop = c.var.shop;
  const me = c.var.session!.staff;
  const b = await c.req.json<{ action?: string; staffId?: string; name?: string; pin?: string; role?: string }>().catch(() => ({}) as Record<string, never>);
  const db = c.env.DB;

  if (b.action === "add") {
    const name = String(b.name || "").trim().slice(0, 40);
    if (!name) return c.json({ ok: false, message: "Enter a name." }, 400);
    if (!isValidPin(b.pin)) return c.json({ ok: false, message: "PIN must be 4–6 digits." }, 400);
    const role = b.role === "owner" ? "owner" : "barista";
    const id = newId();
    await db.prepare(`INSERT INTO staff (id, shop_id, name, pin_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
      .bind(id, shop.id, name, await hashPin(b.pin), role, Date.now())
      .run();
    return c.json({ ok: true, id });
  }

  if (!isId(b.staffId)) return c.json({ ok: false, message: "Unknown staff member." }, 400);
  const target = await db.prepare(`SELECT * FROM staff WHERE id = ? AND shop_id = ?`).bind(b.staffId, shop.id).first<StaffRow>();
  if (!target) return c.json({ ok: false, message: "Unknown staff member." }, 404);

  switch (b.action) {
    case "rename": {
      const name = String(b.name || "").trim().slice(0, 40);
      if (!name) return c.json({ ok: false, message: "Enter a name." }, 400);
      await db.prepare(`UPDATE staff SET name = ? WHERE id = ?`).bind(name, target.id).run();
      return c.json({ ok: true });
    }
    case "reset_pin": {
      if (!isValidPin(b.pin)) return c.json({ ok: false, message: "PIN must be 4–6 digits." }, 400);
      await db.batch([
        db.prepare(`UPDATE staff SET pin_hash = ? WHERE id = ?`).bind(await hashPin(b.pin), target.id),
        // log them out everywhere except the owner's current device
        db.prepare(`DELETE FROM sessions WHERE staff_id = ? AND id != ?`).bind(target.id, c.var.session!.sessionId),
      ]);
      return c.json({ ok: true });
    }
    case "deactivate": {
      if (target.id === me.id) return c.json({ ok: false, message: "You can't deactivate yourself." }, 400);
      await db.batch([
        db.prepare(`UPDATE staff SET active = 0 WHERE id = ?`).bind(target.id),
        db.prepare(`DELETE FROM sessions WHERE staff_id = ?`).bind(target.id),
      ]);
      return c.json({ ok: true });
    }
    case "reactivate":
      await db.prepare(`UPDATE staff SET active = 1 WHERE id = ?`).bind(target.id).run();
      return c.json({ ok: true });
  }
  return c.json({ ok: false, message: "Unknown action." }, 400);
});

app.post("/api/admin/sessions/revoke", async (c) => {
  const b = await c.req.json<{ sessionId?: string }>().catch(() => ({}) as Record<string, never>);
  if (typeof b.sessionId !== "string" || !/^[0-9a-f]{64}$/.test(b.sessionId)) return c.json({ ok: false, message: "Unknown session." }, 400);
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ? AND staff_id IN (SELECT id FROM staff WHERE shop_id = ?)`)
    .bind(b.sessionId, c.var.shop.id)
    .run();
  return c.json({ ok: true });
});

async function getStats(db: D1Database, shopId: string, tz: string) {
  const now = Date.now();
  const since14 = startOfDay(tz, now, 13);
  const [today, week, all, active, total, recent] = await Promise.all([
    totals(db, shopId, startOfDay(tz, now)),
    totals(db, shopId, startOfWeek(tz, now)),
    totals(db, shopId, 0),
    db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE shop_id = ? AND last_seen_at >= ? AND retired_at IS NULL`).bind(shopId, now - 30 * DAY).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE shop_id = ?`).bind(shopId).first<{ n: number }>(),
    db
      .prepare(
        `SELECT e.type, e.amount, e.created_at FROM events e
         WHERE e.shop_id = ? AND e.created_at >= ? AND e.type != 'undo'
           AND NOT EXISTS (SELECT 1 FROM events u WHERE u.undoes_event_id = e.id)`,
      )
      .bind(shopId, since14)
      .all<{ type: string; amount: number; created_at: number }>(),
  ]);
  const days = new Map<string, { date: string; stamps: number; rewards: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = localDate(tz, startOfDay(tz, now, i) + 3_600_000);
    days.set(d, { date: d, stamps: 0, rewards: 0 });
  }
  for (const e of recent.results) {
    const d = days.get(localDate(tz, e.created_at));
    if (!d) continue;
    if (e.type === "stamp") d.stamps += e.amount;
    else if (e.type === "redeem") d.rewards += 1;
  }
  return { today, week, all, activeCards: active?.n ?? 0, totalCards: total?.n ?? 0, perDay: [...days.values()] };
}

app.get("/api/admin/stats", async (c) => c.json(await getStats(c.env.DB, c.var.shop.id, c.var.shop.timezone)));

app.get("/api/admin/export.csv", async (c) => {
  const shop = c.var.shop;
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.created_at, e.type, e.amount, e.undoes_event_id, COALESCE(st.name, 'Customer') AS staff, c.scan_code, e.note
     FROM events e LEFT JOIN staff st ON st.id = e.staff_id JOIN cards c ON c.id = e.card_id
     WHERE e.shop_id = ? ORDER BY e.created_at`,
  )
    .bind(shop.id)
    .all<{ id: string; created_at: number; type: string; amount: number; undoes_event_id: string | null; staff: string; scan_code: string; note: string | null }>();
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [["event_id", "time_utc", "type", "amount", "undoes_event_id", "staff", "card_scan_code", "note"].join(",")];
  for (const r of results) {
    lines.push([r.id, new Date(r.created_at).toISOString(), r.type, r.amount, r.undoes_event_id, r.staff, r.scan_code, r.note].map(cell).join(","));
  }
  return c.body(lines.join("\n") + "\n", 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${shop.id}-events-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "no-store",
  });
});

export default app;
