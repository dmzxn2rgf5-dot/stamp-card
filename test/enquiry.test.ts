// Amendment 01: "Get it for your venue" enquiry form.
import { afterEach, describe, expect, it } from "vitest";
import { ENQUIRY_ACCESS_KEY, ENQUIRY_ENDPOINT } from "../src/config";
import { stripHtml } from "../src/routes/enquiry";
import { call, makeStaff, newCard, uniqueIp } from "./helpers";

async function footer(on: boolean) {
  const owner = await makeStaff("owner");
  await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { theme: { poweredBy: on } } });
}

afterEach(async () => {
  await footer(true);
});

describe("enquiry form", () => {
  it("footer links to the form page", async () => {
    const card = await newCard();
    const body = await (await call(`/card/${card.secretId}`)).text();
    expect(body).toContain("Powered by Stamp Card · ");
    expect(body).toContain('href="/get-stamp-card">Get it for your venue</a>');
    expect(body).not.toContain("github.com");
  });

  it("shows the form in neutral styling with a link to the repo", async () => {
    const owner = await makeStaff("owner");
    expect((await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { primary: "#AA0000" } })).status).toBe(200);
    const card = await newCard();
    expect(await (await call(`/card/${card.secretId}`)).text()).toContain("#AA0000");
    const res = await call("/get-stamp-card");
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Want Stamp Card for your venue?");
    expect(page).toContain("No app. No subscription. Leave your email and we'll be in touch.");
    expect(page).toContain('name="botcheck"');
    expect(page).toMatch(/href="https:\/\/github\.com\/[^"]+\/stamp-card"/);
    expect(page).toContain("#2F6FED");
    expect(page).not.toContain("#AA0000");
    await call("/api/admin/shop", { method: "PATCH", cookie: owner.cookie, json: { primary: "#2F6FED" } });
  });

  it("lets the browser talk to Web3Forms, and works without JS", async () => {
    const res = await call("/get-stamp-card");
    const csp = res.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("connect-src 'self' https://api.web3forms.com");
    expect(csp).toContain("form-action https://api.web3forms.com");
    expect(csp).toContain("script-src 'self'");
    const page = await res.text();
    expect(page).toContain(`action="${ENQUIRY_ENDPOINT}"`);
    expect(page).toContain(`name="access_key" value="${ENQUIRY_ACCESS_KEY}"`);
    // Other pages keep the strict policy.
    expect((await call("/privacy")).headers.get("Content-Security-Policy")).toContain("connect-src 'self';");
  });

  it("returns a cleaned Web3Forms payload for a valid enquiry", async () => {
    const res = await call("/api/enquiry", {
      method: "POST",
      ip: uniqueIp(),
      json: { email: " Owner@Example.com ", venueName: "<b>Harbour</b> Bar", venueType: "bar", botcheck: false },
    });
    const out = (await res.json()) as { ok: boolean; endpoint: string; payload: Record<string, string> };
    expect(out.ok).toBe(true);
    expect(out.endpoint).toBe(ENQUIRY_ENDPOINT);
    const b = out.payload;
    expect(b.access_key).toBe(ENQUIRY_ACCESS_KEY);
    expect(b.subject).toBe("Stamp Card enquiry – Harbour Bar");
    expect(b.from_name).toBe("Stamp Card");
    expect(b.replyto).toBe("owner@example.com");
    expect(b.email).toBe("owner@example.com");
    expect(b.venue_name).toBe("Harbour Bar");
    expect(b.venue_type).toBe("Bar");
    expect(b.deployment).toBe("https://cards.example.com");
    expect(b.botcheck).toBe("");
  });

  it("uses 'No venue name' when the venue is left blank", async () => {
    const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { email: "a@example.com", venueName: "  ", venueType: "nonsense" } });
    const out = (await res.json()) as { payload: Record<string, string> };
    expect(out.payload.subject).toBe("Stamp Card enquiry – No venue name");
    expect(out.payload.venue_type).toBe("Other");
  });

  it("rejects a bad email", async () => {
    const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { email: "not-an-email", venueType: "bar" } });
    expect(res.status).toBe(400);
  });

  it("gives nothing to send for honeypot submissions", async () => {
    const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { email: "bot@example.com", botcheck: true } });
    expect(await res.json()).toEqual({ ok: true, endpoint: null, payload: null });
  });

  it("allows 5 sends per IP per hour", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      expect((await call("/api/enquiry", { method: "POST", ip, json: { email: `p${i}@example.com` } })).status).toBe(200);
    }
    expect((await call("/api/enquiry", { method: "POST", ip, json: { email: "p6@example.com" } })).status).toBe(429);
  });

  it("is hidden when the owner turns the footer off", async () => {
    await footer(false);
    const card = await newCard();
    expect(await (await call(`/card/${card.secretId}`)).text()).not.toContain("get-stamp-card");
    expect((await call("/get-stamp-card")).status).toBe(404);
    expect((await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { email: "a@example.com" } })).status).toBe(404);
  });

  it("strips HTML from fields", () => {
    expect(stripHtml('<script>alert(1)</script>Café <img src=x onerror=1>"Bar"', 100)).toBe('alert(1)Café "Bar"');
    expect(stripHtml("a<b", 100)).toBe("a");
    expect(stripHtml("x".repeat(300), 120)).toHaveLength(120);
  });
});
