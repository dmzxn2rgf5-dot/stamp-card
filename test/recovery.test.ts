import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, cookieFrom, devOutbox, makeStaff, newCard, setStamps, stamp, uniqueIp } from "./helpers";

let emailN = 0;
const freshEmail = () => `Customer${++emailN}.${Date.now()}@Example.com `; // messy on purpose: trimmed + lower-cased

/** Pull the latest link for `to` out of the dev outbox. */
function lastLink(to: string, kind: "verify" | "recover"): string {
  const norm = to.trim().toLowerCase();
  const m = [...devOutbox].reverse().find((e) => e.to === norm && e.text.includes(`/${kind}/`));
  if (!m) throw new Error(`no ${kind} email to ${norm}`);
  return new URL(m.text.match(/https?:\/\/\S+/)![0]).pathname;
}

async function saveEmail(card: { secretId: string }, email: string, optIn = false, ip = uniqueIp()) {
  return call(`/api/card/${card.secretId}/email`, { method: "POST", ip, json: { email, optIn } });
}

/** Card with 1+ stamps and a verified email. */
async function savedCard(stamps = 3, optIn = false) {
  const card = await newCard();
  await setStamps(card.secretId, stamps);
  const email = freshEmail();
  expect((await saveEmail(card, email, optIn)).status).toBe(200);
  const link = lastLink(email, "verify");
  // GET shows a button only (link scanners can't burn the token)…
  expect((await call(link)).status).toBe(200);
  // …the POST confirms.
  const res = await call(link, { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Card saved");
  return { ...card, email: email.trim().toLowerCase() };
}

async function recover(email: string, cookie?: string) {
  await call("/api/recover", { method: "POST", ip: uniqueIp(), json: { email } });
  const link = lastLink(email, "recover");
  return call(link, { method: "POST", cookie });
}

describe("saving a card to email", () => {
  it("needs at least one stamp", async () => {
    const card = await newCard();
    const r = await saveEmail(card, freshEmail());
    expect(r.status).toBe(400);
  });

  it("verifies, normalises the address and records it as email_added", async () => {
    const card = await savedCard();
    const row = await env.DB.prepare(`SELECT email, email_verified_at FROM cards WHERE id = ?`).bind(card.id).first<any>();
    expect(row.email).toBe(card.email);
    expect(row.email_verified_at).toBeTruthy();
    const page = await (await call(`/card/${card.secretId}`)).text();
    expect(page).toContain("Saved to");
    const ev = await env.DB.prepare(`SELECT type FROM events WHERE card_id = ? AND type = 'email_added'`).bind(card.id).first();
    expect(ev).toBeTruthy();
  });

  it("unverified emails can't be used for recovery", async () => {
    const card = await newCard();
    await setStamps(card.secretId, 2);
    const email = freshEmail();
    await saveEmail(card, email);
    const before = devOutbox.length;
    const r: any = await (await call("/api/recover", { method: "POST", ip: uniqueIp(), json: { email } })).json();
    expect(r.message).toContain("If that email has a card");
    expect(devOutbox.length).toBe(before); // nothing sent
  });

  it("one verified card per email per shop", async () => {
    const a = await savedCard();
    const b = await newCard();
    await setStamps(b.secretId, 1);
    await saveEmail(b, a.email);
    const res = await call(lastLink(a.email, "verify"), { method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("already has a card");
  });

  it("customer can remove their email, which clears the opt-in", async () => {
    const card = await savedCard(2, true);
    const r = await call(`/api/card/${card.secretId}/email/remove`, { method: "POST" });
    expect(r.status).toBe(200);
    const row = await env.DB.prepare(`SELECT email, marketing_opt_in FROM cards WHERE id = ?`).bind(card.id).first<any>();
    expect(row).toEqual({ email: null, marketing_opt_in: 0 });
  });

  it("rate limits to 3 emails per address per hour", async () => {
    const card = await newCard();
    await setStamps(card.secretId, 1);
    const email = freshEmail();
    for (let i = 0; i < 3; i++) expect((await saveEmail(card, email)).status).toBe(200);
    expect((await saveEmail(card, email)).status).toBe(429);
  });

  it("rate limits to 10 emails per IP per hour", async () => {
    const ip = uniqueIp();
    const card = await newCard();
    await setStamps(card.secretId, 1);
    for (let i = 0; i < 10; i++) expect((await saveEmail(card, freshEmail(), false, ip)).status).toBe(200);
    expect((await saveEmail(card, freshEmail(), false, ip)).status).toBe(429);
  });
});

describe("recovering a card", () => {
  it("restores the same stamps into a fresh browser and rotates the secret and scan code", async () => {
    const card = await savedCard(4);
    const res = await recover(card.email); // no cookie: browser was cleared
    expect(res.status).toBe(303);
    const loc = res.headers.get("Location")!;
    const newSecret = loc.split("/card/")[1].split("?")[0];
    expect(newSecret).not.toBe(card.secretId);
    expect(cookieFrom(res, "sc_card_main")).toContain(newSecret);

    const state: any = await (await call(`/api/card/${newSecret}`)).json();
    expect(state.stamps).toBe(4);

    // Old URL and old QR stop working.
    expect((await call(`/card/${card.secretId}`)).status).toBe(404);
    expect((await call(`/card/${card.secretId}/qr.svg`)).status).toBe(404);
    const barista = await makeStaff();
    expect((await stamp(barista.cookie, card.scanCode, 1)).status).toBe(404);
  });

  it("merges stamps from the card already in this browser and retires it", async () => {
    const saved = await savedCard(5);
    const other = await newCard();
    await setStamps(other.secretId, 3);
    const res = await recover(saved.email, other.cookie);
    const newSecret = res.headers.get("Location")!.split("/card/")[1].split("?")[0];
    const state: any = await (await call(`/api/card/${newSecret}`)).json();
    expect(state.stamps).toBe(8);
    expect((await call(`/card/${other.secretId}`)).status).toBe(404);
    const retired = await env.DB.prepare(`SELECT retired_at, stamps FROM cards WHERE id = ?`).bind(other.id).first<any>();
    expect(retired.retired_at).toBeTruthy();
    expect(retired.stamps).toBe(0);
    const merge = await env.DB.prepare(`SELECT amount FROM events WHERE card_id = ? AND type = 'merge'`).bind(saved.id).first<any>();
    expect(merge.amount).toBe(3);
  });

  it("unknown email gets the same message and nothing is sent", async () => {
    const before = devOutbox.length;
    const res = await call("/api/recover", { method: "POST", ip: uniqueIp(), json: { email: "nobody-here@example.com" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).message).toBe("If that email has a card, we've sent a link. It expires in 15 minutes.");
    expect(devOutbox.length).toBe(before);
  });

  it("links are single use", async () => {
    const card = await savedCard();
    await call("/api/recover", { method: "POST", ip: uniqueIp(), json: { email: card.email } });
    const link = lastLink(card.email, "recover");
    expect((await call(link, { method: "POST" })).status).toBe(303);
    expect((await call(link, { method: "POST" })).status).toBe(410);
    expect((await call(link)).status).toBe(410);
  });

  it("links expire after 15 minutes", async () => {
    const card = await savedCard();
    await call("/api/recover", { method: "POST", ip: uniqueIp(), json: { email: card.email } });
    const link = lastLink(card.email, "recover");
    await env.DB.prepare(`UPDATE email_tokens SET expires_at = ? WHERE card_id = ? AND purpose = 'recover'`).bind(Date.now() - 1, card.id).run();
    expect((await call(link, { method: "POST" })).status).toBe(410);
  });

  it("tokens are stored only as hashes", async () => {
    const card = await savedCard();
    await call("/api/recover", { method: "POST", ip: uniqueIp(), json: { email: card.email } });
    const token = lastLink(card.email, "recover").split("/").pop()!;
    const row = await env.DB.prepare(`SELECT token_hash FROM email_tokens WHERE token_hash = ?`).bind(token).first();
    expect(row).toBeNull();
  });
});

describe("owner customers admin", () => {
  it("lists verified emails, searches and filters", async () => {
    const owner = await makeStaff("owner");
    const card = await savedCard(3, true);
    const res: any = await (await call(`/api/admin/customers?q=${encodeURIComponent(card.email)}`, { cookie: owner.cookie })).json();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].email).toBe(card.email);
    const byCode: any = await (await call(`/api/admin/customers?q=${card.scanCode.slice(0, 6)}`, { cookie: owner.cookie })).json();
    expect(byCode.rows.some((r: any) => r.id === card.id)).toBe(true);
    const opted: any = await (await call(`/api/admin/customers?optedIn=1&hasEmail=1`, { cookie: owner.cookie })).json();
    expect(opted.rows.every((r: any) => r.marketing_opt_in === 1 && r.email_verified_at)).toBe(true);
  });

  it("sends a recovery link, adjusts stamps with a reason, and deletes a customer – all logged", async () => {
    const owner = await makeStaff("owner");
    const card = await savedCard(2);

    const before = devOutbox.length;
    expect((await call(`/api/admin/customers/${card.id}/send-recovery`, { method: "POST", cookie: owner.cookie })).status).toBe(200);
    expect(devOutbox.length).toBe(before + 1);

    const noReason = await call(`/api/admin/customers/${card.id}`, { method: "PATCH", cookie: owner.cookie, json: { adjust: { amount: 2, reason: "" } } });
    expect(noReason.status).toBe(400);
    const adj: any = await (await call(`/api/admin/customers/${card.id}`, { method: "PATCH", cookie: owner.cookie, json: { adjust: { amount: -1, reason: "double stamped" } } })).json();
    expect(adj.stamps).toBe(1);

    const detail: any = await (await call(`/api/admin/customers/${card.id}`, { cookie: owner.cookie })).json();
    const types = detail.events.map((e: any) => e.type);
    expect(types).toContain("adjust");
    expect(types).toContain("recovery_sent");
    expect(detail.events.find((e: any) => e.type === "adjust").note).toBe("double stamped");

    expect((await call(`/api/admin/customers/${card.id}`, { method: "DELETE", cookie: owner.cookie })).status).toBe(200);
    const row = await env.DB.prepare(`SELECT email, retired_at FROM cards WHERE id = ?`).bind(card.id).first<any>();
    expect(row.email).toBeNull();
    expect(row.retired_at).toBeTruthy();
    expect((await call(`/card/${card.secretId}`)).status).toBe(404);
    const del = await env.DB.prepare(`SELECT staff_id FROM events WHERE card_id = ? AND type = 'deleted'`).bind(card.id).first<any>();
    expect(del.staff_id).toBe(owner.id);
  });

  it("owner email change needs the customer to confirm it", async () => {
    const owner = await makeStaff("owner");
    const card = await savedCard(1);
    const email = freshEmail();
    await call(`/api/admin/customers/${card.id}`, { method: "PATCH", cookie: owner.cookie, json: { email } });
    const row = await env.DB.prepare(`SELECT email, email_verified_at FROM cards WHERE id = ?`).bind(card.id).first<any>();
    expect(row.email).toBe(email.trim().toLowerCase());
    expect(row.email_verified_at).toBeNull();
    expect(lastLink(email, "verify")).toMatch(/^\/verify\//);
  });

  it("baristas can't reach any customer email page or endpoint", async () => {
    const barista = await makeStaff();
    const card = await savedCard();
    expect((await call("/admin/customers", { cookie: barista.cookie })).status).toBe(403);
    expect((await call("/api/admin/customers", { cookie: barista.cookie })).status).toBe(403);
    expect((await call(`/api/admin/customers/${card.id}`, { cookie: barista.cookie })).status).toBe(403);
    expect((await call("/api/admin/customers.csv", { cookie: barista.cookie })).status).toBe(403);
    expect((await call(`/api/admin/customers/${card.id}/send-recovery`, { method: "POST", cookie: barista.cookie })).status).toBe(403);
    expect((await call(`/api/admin/customers/${card.id}`, { method: "DELETE", cookie: barista.cookie })).status).toBe(403);
    // and the stamp screen never shows the email
    expect(await (await call(`/staff/stamp/${card.scanCode}`, { cookie: barista.cookie })).text()).not.toContain(card.email);
  });

  it("opted-in CSV contains only customers who ticked the box", async () => {
    const owner = await makeStaff("owner");
    const yes = await savedCard(1, true);
    const no = await savedCard(1, false);
    const csv = await (await call("/api/admin/customers.csv?optedIn=1", { cookie: owner.cookie })).text();
    expect(csv).toContain(yes.email);
    expect(csv).not.toContain(no.email);
    for (const line of csv.trim().split("\n").slice(1)) expect(line.split(",")[5]).toBe("yes");
    const all = await (await call("/api/admin/customers.csv", { cookie: owner.cookie })).text();
    expect(all).toContain(no.email);
  });

  it("undo still works on a stamp after an email was added", async () => {
    const barista = await makeStaff();
    const card = await savedCard(1);
    const s = await stamp(barista.cookie, card.scanCode, 1);
    const u = await call("/api/staff/undo", { method: "POST", cookie: barista.cookie, json: { eventId: s.body.eventId } });
    expect(u.status).toBe(200);
  });
});
