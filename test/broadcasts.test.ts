import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeStaff, newCard } from "./helpers";

async function publish(cookie: string, message: string, endDate?: string) {
  const res = await call("/api/admin/broadcasts", { method: "POST", cookie, json: { message, endDate } });
  return { status: res.status, body: (await res.json()) as any };
}
const cardHtml = async (secretId: string) => (await call(`/card/${secretId}`)).text();
const cardApi = async (secretId: string) => (await (await call(`/api/card/${secretId}`)).json()) as any;
const dismiss = (secretId: string, id: string) => call(`/api/card/${secretId}/broadcast/${id}/dismiss`, { method: "POST" });

// Each test starts with no live broadcast.
beforeEach(async () => {
  await env.DB.prepare(`UPDATE broadcasts SET ended_at = ? WHERE ended_at IS NULL`).bind(Date.now()).run();
});

describe("broadcast offers", () => {
  it("owner publishes and the admin page shows a live preview with the real logo", async () => {
    const owner = await makeStaff("owner");
    const page = await (await call("/admin/broadcasts", { cookie: owner.cookie })).text();
    expect(page).toContain('class="bc-preview"');
    expect(page).toContain("/img/logo.svg");
    const r = await publish(owner.cookie, "Double stamps all weekend!");
    expect(r.status).toBe(200);
  });

  it("customer sees the pop-up with logo, secondary background and text colour, message escaped", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    await publish(owner.cookie, "Free cake <script>alert(1)</script>\nToday only");
    const html = await cardHtml(card.secretId);
    expect(html).toContain('class="bc-overlay"');
    expect(html).toContain('class="bc-logo"');
    expect(html).toContain("--broadcast-bg:#0B1F4B"); // default secondary
    expect(html).toContain("--on-primary:#FFFFFF");
    expect(html).toContain("Free cake &lt;script&gt;alert(1)&lt;/script&gt;\nToday only");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("closing records a view (safe twice) and it never shows again on that card", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    const { body } = await publish(owner.cookie, "Hello");
    expect((await cardApi(card.secretId)).broadcast).toEqual({ id: body.id, message: "Hello" });
    expect((await dismiss(card.secretId, body.id)).status).toBe(200);
    expect((await dismiss(card.secretId, body.id)).status).toBe(200);
    expect(await cardHtml(card.secretId)).not.toContain("bc-overlay");
    expect((await cardApi(card.secretId)).broadcast).toBeNull();
  });

  it("posting B before A was seen shows only B", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    await publish(owner.cookie, "Offer A");
    const b = await publish(owner.cookie, "Offer B");
    const s = await cardApi(card.secretId);
    expect(s.broadcast).toEqual({ id: b.body.id, message: "Offer B" });
    await dismiss(card.secretId, b.body.id);
    // never falls back to A
    expect((await cardApi(card.secretId)).broadcast).toBeNull();
  });

  it("new customers who join while it's live see it on first load", async () => {
    const owner = await makeStaff("owner");
    await publish(owner.cookie, "Welcome offer");
    const card = await newCard();
    expect(await cardHtml(card.secretId)).toContain("Welcome offer");
  });

  it("polling never carries broadcasts", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    await publish(owner.cookie, "Not mid-visit");
    await env.DB.prepare(`UPDATE cards SET version = version + 1 WHERE id = ?`).bind(card.id).run();
    const polled: any = await (await call(`/api/card/${card.secretId}?since=0`)).json();
    expect(polled.broadcast).toBeUndefined();
  });

  it("ending it or passing its end date stops it showing", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    const a = await publish(owner.cookie, "Ends now");
    expect((await call(`/api/admin/broadcasts/${a.body.id}/end`, { method: "POST", cookie: owner.cookie })).status).toBe(200);
    expect((await cardApi(card.secretId)).broadcast).toBeNull();

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const b = await publish(owner.cookie, "Expires", tomorrow);
    expect((await cardApi(card.secretId)).broadcast?.id).toBe(b.body.id);
    await env.DB.prepare(`UPDATE broadcasts SET ends_at = ? WHERE id = ?`).bind(Date.now() - 1, b.body.id).run();
    expect((await cardApi(card.secretId)).broadcast).toBeNull();
  });

  it("switching the background to primary updates the pop-up", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    await publish(owner.cookie, "Colour test");
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { broadcastBg: "primary" } });
    expect(await cardHtml(card.secretId)).toContain("--broadcast-bg:#2F6FED");
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { broadcastBg: "secondary" } });
  });

  it("seen counts match the number of cards that closed it", async () => {
    const owner = await makeStaff("owner");
    const { body } = await publish(owner.cookie, "Count me");
    const cards = await Promise.all([newCard(), newCard(), newCard()]);
    await dismiss(cards[0].secretId, body.id);
    await dismiss(cards[1].secretId, body.id);
    await dismiss(cards[1].secretId, body.id); // twice: still one
    const list: any = await (await call("/api/admin/broadcasts", { cookie: owner.cookie })).json();
    expect(list.current.id).toBe(body.id);
    expect(list.current.seen).toBe(2);
  });

  it("rejects empty and over-long messages", async () => {
    const owner = await makeStaff("owner");
    expect((await publish(owner.cookie, "   ")).status).toBe(400);
    expect((await publish(owner.cookie, "x".repeat(281))).status).toBe(400);
    expect((await publish(owner.cookie, "x".repeat(280))).status).toBe(200);
  });

  it("baristas can't manage broadcasts", async () => {
    const b = await makeStaff();
    expect((await call("/admin/broadcasts", { cookie: b.cookie })).status).toBe(403);
    expect((await publish(b.cookie, "nope")).status).toBe(403);
    expect((await call("/api/admin/broadcasts", { cookie: b.cookie })).status).toBe(403);
  });

  it("can't dismiss for another shop's or a made-up broadcast", async () => {
    const card = await newCard();
    expect((await dismiss(card.secretId, "doesNotExist00000000")).status).toBe(200);
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM broadcast_views WHERE broadcast_id = 'doesNotExist00000000'`).first<{ n: number }>();
    expect(row!.n).toBe(0);
  });
});

describe("brand colours", () => {
  it("a new shop starts with the neutral default colours", async () => {
    const shop = await env.DB.prepare(`SELECT primary_colour, secondary_colour, text_colour, broadcast_bg FROM shops WHERE id = 'main'`).first<any>();
    expect(shop).toEqual({ primary_colour: "#2F6FED", secondary_colour: "#0B1F4B", text_colour: "#FFFFFF", broadcast_bg: "secondary" });
  });

  it("validates hex values and the broadcast background option", async () => {
    const owner = await makeStaff("owner");
    expect((await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { secondary: "navy" } })).status).toBe(400);
    expect((await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { broadcastBg: "accent" } })).status).toBe(400);
  });

  it("admin warns when the text colour fails WCAG AA on the pop-up background", async () => {
    const owner = await makeStaff("owner");
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { text: "#2A2D70" } });
    const page = await (await call("/admin/broadcasts", { cookie: owner.cookie })).text();
    expect(page).toContain('"contrastOk":false');
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { text: "#FFFFFF" } });
    const ok = await (await call("/admin/broadcasts", { cookie: owner.cookie })).text();
    expect(ok).toContain('"contrastOk":true');
  });
});
