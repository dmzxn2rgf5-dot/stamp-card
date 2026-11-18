import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ORIGIN, call, cookieFrom, makeStaff, newCard, setStamps, stamp, uniqueIp } from "./helpers";

describe("customer cards", () => {
  it("creates a card on first visit and reuses it via cookie", async () => {
    const card = await newCard();
    expect(card.secretId).toMatch(/^[0-9A-Za-z]{24}$/);
    expect(card.scanCode).toMatch(/^[0-9A-Z]{10}$/);

    const again = await call("/join", { cookie: card.cookie });
    expect(again.status).toBe(302);
    expect(again.headers.get("Location")).toBe(`/card/${card.secretId}`);
  });

  it("recovers a card from the localStorage fallback", async () => {
    const card = await newCard();
    const res = await call(`/join?ls=${card.secretId}`);
    expect(res.headers.get("Location")).toBe(`/card/${card.secretId}`);
    expect(cookieFrom(res, "sc_card_main")).toContain(card.secretId);
  });

  it("without a cookie, /join asks the browser to check localStorage before creating", async () => {
    const res = await call("/join");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/js/join.js");
  });

  it("card page shows the shop branding, QR and card code", async () => {
    const card = await newCard();
    const res = await call(`/card/${card.secretId}`);
    const page = await res.text();
    expect(res.status).toBe(200);
    expect(page).toContain("Your Shop");
    expect(page).toContain("--primary:#2F6FED");
    expect(page).toContain(`/card/${card.secretId}/qr.svg`);
    // The public scan code is shown (for typing in if a camera won't scan); the secret is never in the QR.
    expect(page).toContain(`${card.scanCode.slice(0, 5)}·${card.scanCode.slice(5)}`);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("card JSON supports ?since and is no-store", async () => {
    const card = await newCard();
    const res = await call(`/api/card/${card.secretId}`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body: any = await res.json();
    expect(body).toEqual({ stamps: 0, required: 10, rewardReady: false, version: 0, rewardsRedeemed: 0, broadcast: null });
    expect((await call(`/api/card/${card.secretId}?since=0`)).status).toBe(204);
  });

  it("QR encodes the staff stamp URL", async () => {
    const card = await newCard();
    const res = await call(`/card/${card.secretId}/qr.svg`);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  it("scan code can't open a card", async () => {
    const card = await newCard();
    expect((await call(`/card/${card.scanCode}`)).status).toBe(404);
    expect((await call(`/api/card/${card.scanCode}`)).status).toBe(404);
  });

  it("rate limits card creation to 20 per hour per IP", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 20; i++) expect((await call("/join?new=1", { ip })).status).toBe(302);
    expect((await call("/join?new=1", { ip })).status).toBe(429);
  });
});

describe("stamping", () => {
  it("adds stamps and the card sees the change", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const r = await stamp(staff.cookie, card.scanCode, 2);
    expect(r.status).toBe(200);
    expect(r.body.stamps).toBe(2);
    const state: any = await (await call(`/api/card/${card.secretId}?since=0`)).json();
    expect(state.stamps).toBe(2);
    expect(state.version).toBe(1);
  });

  it("enforces the per-scan limit", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const r = await stamp(staff.cookie, card.scanCode, 6);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("OVER_SCAN_LIMIT");
  });

  it("enforces the per-day limit", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    expect((await stamp(staff.cookie, card.scanCode, 5)).status).toBe(200);
    expect((await stamp(staff.cookie, card.scanCode, 5)).status).toBe(200);
    const r = await stamp(staff.cookie, card.scanCode, 1);
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("DAILY_LIMIT");
  });

  it("is idempotent for double taps", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const key = "idemKey0000000000001";
    const [a, b] = await Promise.all([stamp(staff.cookie, card.scanCode, 1, key), stamp(staff.cookie, card.scanCode, 1, key)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.eventId).toBe(b.body.eventId);
    const row = await env.DB.prepare(`SELECT stamps FROM cards WHERE id = ?`).bind(card.id).first<{ stamps: number }>();
    expect(row!.stamps).toBe(1);
  });

  it("never loses concurrent stamps from two baristas", async () => {
    const a = await makeStaff();
    const b = await makeStaff();
    const card = await newCard();
    const results = await Promise.all([stamp(a.cookie, card.scanCode, 2), stamp(b.cookie, card.scanCode, 3), stamp(a.cookie, card.scanCode, 1)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const row = await env.DB.prepare(`SELECT stamps, version FROM cards WHERE id = ?`).bind(card.id).first<{ stamps: number; version: number }>();
    expect(row!.stamps).toBe(6);
    expect(row!.version).toBe(3);
    const ev = await env.DB.prepare(`SELECT SUM(amount) AS n FROM events WHERE card_id = ?`).bind(card.id).first<{ n: number }>();
    expect(ev!.n).toBe(6);
  });

  it("shows card-not-found for an unknown scan code", async () => {
    const staff = await makeStaff();
    expect((await call("/staff/stamp/ABCDEFGHJK", { cookie: staff.cookie })).status).toBe(404);
    expect((await stamp(staff.cookie, "ABCDEFGHJK", 1)).status).toBe(404);
  });
});

describe("rewards", () => {
  it("only redeems at the threshold, resets and rolls over extra stamps", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    await setStamps(card.secretId, 9);
    const early = await call("/api/staff/redeem", { method: "POST", cookie: staff.cookie, json: { scanCode: card.scanCode } });
    expect(early.status).toBe(409);

    const s = await stamp(staff.cookie, card.scanCode, 2);
    expect(s.body.stamps).toBe(11);
    expect(s.body.rewardReady).toBe(true);

    const r = await call("/api/staff/redeem", { method: "POST", cookie: staff.cookie, json: { scanCode: card.scanCode, idempotencyKey: "redeemKey00000000001" } });
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body.stamps).toBe(1);
    expect(body.rewardsRedeemed).toBe(1);

    // same idempotency key → no double redeem
    const again: any = await (await call("/api/staff/redeem", { method: "POST", cookie: staff.cookie, json: { scanCode: card.scanCode, idempotencyKey: "redeemKey00000000001" } })).json();
    expect(again.stamps).toBe(1);
    // and a fresh redeem is refused
    expect((await call("/api/staff/redeem", { method: "POST", cookie: staff.cookie, json: { scanCode: card.scanCode } })).status).toBe(409);
  });

  it("stamp screen offers Redeem when the card is full", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    await setStamps(card.secretId, 10);
    const html = await (await call(`/staff/stamp/${card.scanCode}`, { cookie: staff.cookie })).text();
    expect(html).toContain('id="redeem"');
  });

  it("lowering stamps required makes existing cards reward-ready", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    await setStamps(card.secretId, 8);
    const patch = await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { stampsRequired: 8 } });
    expect(patch.status).toBe(200);
    const s: any = await (await call(`/api/card/${card.secretId}`)).json();
    expect(s).toMatchObject({ stamps: 8, required: 8, rewardReady: true });
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { stampsRequired: 10 } });
  });
});

describe("undo", () => {
  it("reverses a stamp within 5 minutes", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const s = await stamp(staff.cookie, card.scanCode, 3);
    const u = await call("/api/staff/undo", { method: "POST", cookie: staff.cookie, json: { eventId: s.body.eventId } });
    expect(u.status).toBe(200);
    expect(((await u.json()) as any).stamps).toBe(0);
    // can't undo twice
    expect((await call("/api/staff/undo", { method: "POST", cookie: staff.cookie, json: { eventId: s.body.eventId } })).status).toBe(409);
  });

  it("fails after 5 minutes", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const s = await stamp(staff.cookie, card.scanCode, 1);
    await env.DB.prepare(`UPDATE events SET created_at = created_at - 301000 WHERE id = ?`).bind(s.body.eventId).run();
    const u = await call("/api/staff/undo", { method: "POST", cookie: staff.cookie, json: { eventId: s.body.eventId } });
    expect(u.status).toBe(409);
    expect(((await u.json()) as any).code).toBe("UNDO_EXPIRED");
  });

  it("undoes a redeem, restoring stamps and reward count", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    await setStamps(card.secretId, 10);
    const r: any = await (await call("/api/staff/redeem", { method: "POST", cookie: staff.cookie, json: { scanCode: card.scanCode } })).json();
    const u: any = await (await call("/api/staff/undo", { method: "POST", cookie: staff.cookie, json: { eventId: r.eventId } })).json();
    expect(u).toMatchObject({ ok: true, stamps: 10, rewardsRedeemed: 0 });
  });

  it("only the same barista or the owner can undo", async () => {
    const a = await makeStaff();
    const b = await makeStaff();
    const owner = await makeStaff("owner");
    const card = await newCard();
    const s = await stamp(a.cookie, card.scanCode, 1);
    expect((await call("/api/staff/undo", { method: "POST", cookie: b.cookie, json: { eventId: s.body.eventId } })).status).toBe(403);
    expect((await call("/api/staff/undo", { method: "POST", cookie: owner.cookie, json: { eventId: s.body.eventId } })).status).toBe(200);
  });

  it("only the latest change on a card can be undone", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const first = await stamp(staff.cookie, card.scanCode, 1);
    await stamp(staff.cookie, card.scanCode, 1);
    const u = await call("/api/staff/undo", { method: "POST", cookie: staff.cookie, json: { eventId: first.body.eventId } });
    expect(u.status).toBe(409);
  });
});

describe("in-app scanner", () => {
  it("needs a staff login and allows the camera for this site only", async () => {
    const out = await call("/staff/scan");
    expect(out.status).toBe(302);
    expect(out.headers.get("Location")).toContain("/staff/login?next=%2Fstaff%2Fscan");
    const staff = await makeStaff();
    const res = await call("/staff/scan", { cookie: staff.cookie });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("/js/vendor/jsQR.js");
    expect(page).toContain('<video id="video" playsinline');
    expect(res.headers.get("Permissions-Policy")).toContain("camera=(self)");
  });

  it("staff home and the stamp screen link to the scanner", async () => {
    const staff = await makeStaff();
    expect(await (await call("/staff", { cookie: staff.cookie })).text()).toContain('href="/staff/scan"');
    const card = await newCard();
    expect(await (await call(`/staff/stamp/${card.scanCode}`, { cookie: staff.cookie })).text()).toContain("Scan next card");
  });
});

describe("auth", () => {
  it("staff APIs need a session", async () => {
    const card = await newCard();
    expect((await stamp("", card.scanCode, 1)).status).toBe(401);
  });

  it("rejects cross-origin state changes", async () => {
    const staff = await makeStaff();
    const card = await newCard();
    const res = await call("/api/staff/stamp", {
      method: "POST",
      cookie: staff.cookie,
      headers: { Origin: "https://evil.example" },
      json: { scanCode: card.scanCode, amount: 1 },
    });
    expect(res.status).toBe(403);
  });

  it("logged-out barista is bounced, then sent to login and back", async () => {
    const card = await newCard();
    const bounce = await call(`/staff/stamp/${card.scanCode}`);
    expect(bounce.status).toBe(200);
    expect(await bounce.text()).toContain("bounce.js");
    const res = await call(`/staff/stamp/${card.scanCode}?r=1`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/staff/login?next=${encodeURIComponent(`/staff/stamp/${card.scanCode}`)}`);
  });

  it("rate limits wrong PINs (5 per 15 minutes)", async () => {
    const staff = await makeStaff("barista", "4321");
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      const r = await call("/api/staff/login", { method: "POST", ip, json: { staffId: staff.id, pin: "0000" } });
      expect(r.status).toBe(401);
    }
    const blocked = await call("/api/staff/login", { method: "POST", ip, json: { staffId: staff.id, pin: "4321" } });
    expect(blocked.status).toBe(429);
    // per-staff limit also applies from another IP
    const other = await call("/api/staff/login", { method: "POST", ip: uniqueIp(), json: { staffId: staff.id, pin: "4321" } });
    expect(other.status).toBe(429);
  });

  it("rate limits stamping to 30 a minute per session", async () => {
    const staff = await makeStaff();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await stamp(staff.cookie, "ABCDEFGHJK", 1)).status;
    expect(last).toBe(429);
  });

  it("deactivating a barista ends their sessions", async () => {
    const owner = await makeStaff("owner");
    const b = await makeStaff();
    const res = await call("/api/admin/staff", { method: "POST", cookie: owner.cookie, json: { action: "deactivate", staffId: b.id } });
    expect(res.status).toBe(200);
    const card = await newCard();
    expect((await stamp(b.cookie, card.scanCode, 1)).status).toBe(401);
  });

  it("baristas can't use admin APIs", async () => {
    const b = await makeStaff();
    expect((await call("/api/admin/stats", { cookie: b.cookie })).status).toBe(403);
  });

  it("one-time owner setup works once with the right token", async () => {
    // remove any owners created by earlier tests in this file
    await env.DB.prepare(`UPDATE staff SET role = 'barista' WHERE role = 'owner'`).run();
    expect((await call("/setup?token=wrong")).status).toBe(404);
    expect((await call("/setup?token=test-setup-token")).status).toBe(200);
    const res = await call("/api/setup", { method: "POST", ip: uniqueIp(), json: { token: "test-setup-token", name: "Owner", pin: "2468" } });
    expect(res.status).toBe(200);
    expect(cookieFrom(res, "sc_staff")).toBeTruthy();
    expect((await call("/setup?token=test-setup-token")).status).toBe(404);
  });
});

describe("admin & branding", () => {
  it("owner can re-brand the shop and pages pick it up", async () => {
    const owner = await makeStaff("owner");
    const res = await call("/api/admin/shop", {
      method: "PATCH",
      cookie: owner.cookie,
      json: { primary: "#AA0000", secondary: "#220000", text: "#FFFFFF", theme: { accent: "#00AA00", stampIcon: "star" } },
    });
    expect(res.status).toBe(200);
    const card = await newCard();
    const page = await (await call(`/card/${card.secretId}`)).text();
    expect(page).toContain("--primary:#AA0000");
    expect(page).toContain("--secondary:#220000");
    expect(page).toContain("--accent:#00AA00");
    // reset back to the defaults
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { reset: true } });
    const after = await (await call(`/card/${card.secretId}`)).text();
    expect(after).toContain("--primary:#2F6FED");
    expect(after).toContain("--secondary:#0B1F4B");
  });

  it("rejects bad colours", async () => {
    const owner = await makeStaff("owner");
    const res = await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { primary: "red;}" } });
    expect(res.status).toBe(400);
  });

  it("exports CSV and renders the poster", async () => {
    const owner = await makeStaff("owner");
    const csv = await call("/api/admin/export.csv", { cookie: owner.cookie });
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect((await csv.text()).split("\n")[0]).toContain("event_id");
    const poster = await (await call("/admin/poster", { cookie: owner.cookie })).text();
    expect(poster).toContain("Scan for your loyalty card");
    const admin = await call("/admin/", { cookie: owner.cookie });
    expect(admin.status).toBe(200);
  });

  it("stats endpoint returns totals", async () => {
    const owner = await makeStaff("owner");
    const s: any = await (await call("/api/admin/stats", { cookie: owner.cookie })).json();
    expect(s.perDay).toHaveLength(14);
    expect(typeof s.today.stamps).toBe("number");
  });
});

void ORIGIN;
