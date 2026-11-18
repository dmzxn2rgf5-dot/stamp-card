// Stamp Card v1: setup wizard, uploads, "Powered by", email switched off, no venue-specific wording.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { publicOrigin } from "../src/lib/url";
import { call, cookieFrom, makeStaff, newCard, uniqueIp } from "./helpers";

const OFF = { EMAIL_RECOVERY: "off" };
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], "logo.png", { type: "image/png" });
const svg = (body: string) => new File([`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`], "logo.svg", { type: "image/svg+xml" });
const upload = (path: string, cookie: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return call(path, { method: "POST", cookie, body: fd });
};

describe("setup wizard", () => {
  it("is a 404 without the token", async () => {
    expect((await call("/setup")).status).toBe(404);
    expect((await call("/setup?token=wrong")).status).toBe(404);
    expect((await call("/api/setup", { method: "POST", json: { token: "wrong", ownerName: "Owner", pin: "1234" }, ip: uniqueIp() })).status).toBe(403);
  });

  it("brands the shop in one go, then is gone for good", async () => {
    const page = await call("/setup?token=test-setup-token");
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const step of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]) expect(html).toContain(step);
    expect(html).toContain('class="bc-preview"'); // live pop-up preview

    const res = await call("/api/setup", {
      method: "POST",
      ip: uniqueIp(),
      json: {
        token: "test-setup-token", ownerName: "Owner", pin: "2468", shopName: "Harbour Bar", venueType: "bar",
        primary: "#123456", secondary: "#0a0a0a", text: "#ffffff", stampsRequired: 8, rewardLabel: "Free pint",
      },
    });
    expect(res.status).toBe(200);
    const owner = cookieFrom(res, "sc_staff")!;
    expect(owner).toBeTruthy();

    const card = await newCard();
    const cardPage = await (await call(`/card/${card.secretId}`)).text();
    expect(cardPage).toContain("Harbour Bar");
    expect(cardPage).toContain("--primary:#123456");
    expect(cardPage).toContain("--secondary:#0A0A0A");
    expect(cardPage).toContain("for a free pint");
    expect(cardPage).toContain("of 8 stamps");
    // venue type "bar" picked the glass icon
    expect(cardPage).toContain('<path d="M10 6h28l-3 18a11 11 0 01-22 0z"');

    // logo uploaded after the account exists (the wizard does this with the new session)
    expect((await upload("/api/admin/logo", owner, png())).status).toBe(200);
    expect(await (await call(`/card/${card.secretId}`)).text()).toMatch(/src="\/logo\?v=\d+"/);

    expect((await call("/setup?token=test-setup-token")).status).toBe(404);
    expect((await call("/api/setup", { method: "POST", ip: uniqueIp(), json: { token: "test-setup-token", ownerName: "Other", pin: "1111" } })).status).toBe(403);
  });
});

describe("logo and stamp icon uploads", () => {
  it("stores the logo in D1 and serves it from /logo", async () => {
    const owner = await makeStaff("owner");
    expect((await upload("/api/admin/logo", owner.cookie, png())).status).toBe(200);
    const res = await call("/logo");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("accepts a plain SVG, served locked down", async () => {
    const owner = await makeStaff("owner");
    expect((await upload("/api/admin/logo", owner.cookie, svg('<circle cx="5" cy="5" r="4" fill="#2F6FED"/>'))).status).toBe(200);
    const res = await call("/logo");
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
  });

  it("refuses SVGs that could run code or load other files", async () => {
    const owner = await makeStaff("owner");
    for (const bad of [
      "<script>alert(1)</script>",
      '<circle r="4" onload="alert(1)"/>',
      '<a href="javascript:alert(1)"><circle r="4"/></a>',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
      '<image href="https://example.com/x.png"/>',
      '<style>@import url(https://example.com/x.css);</style>',
    ]) {
      const res = await upload("/api/admin/logo", owner.cookie, svg(bad));
      expect(res.status, bad).toBe(400);
    }
  });

  it("refuses files over 200 KB and other types", async () => {
    const owner = await makeStaff("owner");
    const big = new File([new Uint8Array(201 * 1024)], "big.png", { type: "image/png" });
    expect((await upload("/api/admin/logo", owner.cookie, big)).status).toBe(400);
    const gif = new File([new Uint8Array([1, 2, 3])], "x.gif", { type: "image/gif" });
    expect((await upload("/api/admin/logo", owner.cookie, gif)).status).toBe(400);
  });

  it("a custom stamp icon replaces the built-in one on the card", async () => {
    const owner = await makeStaff("owner");
    expect((await upload("/api/admin/stamp-icon", owner.cookie, png())).status).toBe(200);
    const card = await newCard();
    expect(await (await call(`/card/${card.secretId}`)).text()).toMatch(/<img class="stamp-art" src="\/stamp-icon\?v=\d+"/);
    expect((await call("/stamp-icon")).status).toBe(200);
    // switch back to a built-in icon
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { theme: { stampIcon: "star" } } });
    expect(await (await call(`/card/${card.secretId}`)).text()).not.toContain('class="stamp-art" src="/stamp-icon');
  });
});

describe("Powered by Stamp Card", () => {
  it("shows by default and the owner can turn it off", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { theme: { poweredBy: true } } });
    expect(await (await call(`/card/${card.secretId}`)).text()).toContain("Powered by Stamp Card");
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { theme: { poweredBy: false } } });
    expect(await (await call(`/card/${card.secretId}`)).text()).not.toContain("Powered by Stamp Card");
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { theme: {} } });
    expect(await (await call(`/card/${card.secretId}`)).text()).toContain("Powered by Stamp Card");
  });
});

describe("email recovery switched off (the default)", () => {
  it("hides every email feature from customers", async () => {
    const card = await newCard();
    await env.DB.prepare(`UPDATE cards SET stamps = 2 WHERE id = ?`).bind(card.id).run();
    const page = await (await call(`/card/${card.secretId}`, { vars: OFF })).text();
    expect(page).not.toContain("save-card");
    expect(page).not.toContain("/recover");
    const visible = page.replace(/<script[^>]*type="application\/json"[^>]*>[\s\S]*?<\/script>/g, "");
    expect(visible).not.toMatch(/email/i);
    expect(await (await call("/privacy", { vars: OFF })).text()).not.toMatch(/email/i);
    expect((await call("/recover", { vars: OFF })).status).toBe(404);
    expect((await call("/api/recover", { method: "POST", vars: OFF, json: { email: "a@example.com" } })).status).toBe(404);
    expect((await call(`/api/card/${card.secretId}/email`, { method: "POST", vars: OFF, json: { email: "a@example.com" } })).status).toBe(404);
  });

  it("hides email from the owner's customer list and export", async () => {
    const owner = await makeStaff("owner");
    const list = await (await call("/admin/customers", { cookie: owner.cookie, vars: OFF })).text();
    expect(list).not.toContain("<th>Email</th>");
    expect(list).not.toContain("Opted in to offers");
    const csv = await (await call("/api/admin/customers.csv", { cookie: owner.cookie, vars: OFF })).text();
    expect(csv.split("\n")[0]).not.toContain("email");
    const card = await newCard();
    expect((await call(`/api/admin/customers/${card.id}/send-recovery`, { method: "POST", cookie: owner.cookie, vars: OFF })).status).toBe(404);
  });
});

describe("generic wording", () => {
  it("customer and staff pages never mention coffee or baristas", async () => {
    const owner = await makeStaff("owner");
    const card = await newCard();
    const pages = [`/card/${card.secretId}`, "/privacy", "/staff/login", "/join"];
    for (const p of pages) {
      const text = await (await call(p, { vars: OFF })).text();
      expect(text, p).not.toMatch(/coffee|barista/i);
    }
    const admin = await (await call("/admin/", { cookie: owner.cookie })).text();
    expect(admin.replace(/value="barista"/g, "")).not.toMatch(/coffee|barista/i);
  });
});

describe("PUBLIC_URL", () => {
  it("is used for links when set, otherwise the request origin", () => {
    expect(publicOrigin({ PUBLIC_URL: "https://cards.example.org/" } as never, "https://x.workers.dev/a")).toBe("https://cards.example.org");
    expect(publicOrigin({} as never, "https://x.workers.dev/a")).toBe("https://x.workers.dev");
    expect(publicOrigin({ PUBLIC_URL: "not a url" } as never, "https://x.workers.dev/a")).toBe("https://x.workers.dev");
  });
});
