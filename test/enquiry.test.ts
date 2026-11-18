// Amendments 01 and 04: "Get it for your venue" enquiry form, now on the website.
import { afterEach, describe, expect, it } from "vitest";
import { ENQUIRY_ACCESS_KEY, ENQUIRY_ENDPOINT } from "../src/config";
import { GET_IT_URL, SITE_URL } from "../src/defaults";
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
  it("footer links to the form on the Stamp Card website, in a new tab", async () => {
    const card = await newCard();
    const body = await (await call(`/card/${card.secretId}`)).text();
    expect(body).toContain("Powered by Stamp Card · ");
    expect(body).toContain(`<a href="${GET_IT_URL}" target="_blank" rel="noopener">Get it for your venue</a>`);
    expect(body).not.toContain("/get-stamp-card");
  });

  it("redirects the old /get-stamp-card page to the website", async () => {
    const res = await call("/get-stamp-card");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(GET_IT_URL);
    expect(GET_IT_URL).toBe("https://dmzxn2rgf5-dot.github.io/stamp-card/get-it/");
  });

  it("returns a cleaned Web3Forms payload for a valid enquiry", async () => {
    const res = await call("/api/enquiry", {
      method: "POST",
      ip: uniqueIp(),
      json: { choice: "kit", email: " Owner@Example.com ", venueName: "<b>Harbour</b> Bar", venueType: "bar", botcheck: false },
    });
    const out = (await res.json()) as { ok: boolean; endpoint: string; payload: Record<string, string> };
    expect(out.ok).toBe(true);
    expect(out.endpoint).toBe(ENQUIRY_ENDPOINT);
    const b = out.payload;
    expect(b.access_key).toBe(ENQUIRY_ACCESS_KEY);
    expect(b.subject).toBe("Stamp Card enquiry – Guided kit – Harbour Bar");
    expect(b.choice).toBe("Guided kit – £25");
    expect(Object.keys(b).filter((k) => k !== "access_key")[0]).toBe("choice");
    expect(b.from_name).toBe("Stamp Card");
    expect(b.replyto).toBe("owner@example.com");
    expect(b.email).toBe("owner@example.com");
    expect(b.venue_name).toBe("Harbour Bar");
    expect(b.venue_type).toBe("Bar");
    expect(b.deployment).toBe("https://cards.example.com");
    expect(b.botcheck).toBe("");
  });

  it("uses 'No venue name' when the venue is left blank", async () => {
    const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { choice: "curious", email: "a@example.com", venueName: "  ", venueType: "nonsense" } });
    const out = (await res.json()) as { payload: Record<string, string> };
    expect(out.payload.subject).toBe("Stamp Card enquiry – Just curious – No venue name");
    expect(out.payload.venue_type).toBe("Other");
  });

  it("can't be sent without picking an option", async () => {
    for (const choice of [undefined, "", "free-money", "toString"]) {
      const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { choice, email: "a@example.com" } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { message: string }).message).toBe("Please pick an option.");
    }
  });

  it("puts each option in the subject", async () => {
    for (const [choice, label] of [["kit", "Guided kit"], ["done", "Done for you"], ["curious", "Just curious"]]) {
      const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { choice, email: "a@example.com", venueName: "Cafe" } });
      const out = (await res.json()) as { payload: Record<string, string> };
      expect(out.payload.subject).toBe(`Stamp Card enquiry – ${label} – Cafe`);
    }
  });

  it("rejects a bad email", async () => {
    const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { choice: "curious", email: "not-an-email", venueType: "bar" } });
    expect(res.status).toBe(400);
  });

  it("gives nothing to send for honeypot submissions", async () => {
    const res = await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { choice: "curious", email: "bot@example.com", botcheck: true } });
    expect(await res.json()).toEqual({ ok: true, endpoint: null, payload: null });
  });

  it("allows 5 sends per IP per hour", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      expect((await call("/api/enquiry", { method: "POST", ip, json: { choice: "curious", email: `p${i}@example.com` } })).status).toBe(200);
    }
    expect((await call("/api/enquiry", { method: "POST", ip, json: { choice: "curious", email: "p6@example.com" } })).status).toBe(429);
  });

  it("is hidden when the owner turns the footer off", async () => {
    await footer(false);
    const card = await newCard();
    expect(await (await call(`/card/${card.secretId}`)).text()).not.toContain(GET_IT_URL);
    expect((await call("/get-stamp-card")).status).toBe(404);
    expect((await call("/api/enquiry", { method: "POST", ip: uniqueIp(), json: { choice: "curious", email: "a@example.com" } })).status).toBe(404);
  });

  it("shows the website line on the counter poster, and hides it with the footer", async () => {
    const owner = await makeStaff("owner");
    const line = `Run a café, bar or takeaway? Get Stamp Card free – ${SITE_URL}`;
    const on = await (await call("/admin/poster", { cookie: owner.cookie })).text();
    expect(on).toContain(`<p class="poster-foot">${line}</p>`);
    expect(on.indexOf("poster-foot")).toBeGreaterThan(on.lastIndexOf('class="band"'));
    await footer(false);
    expect(await (await call("/admin/poster", { cookie: owner.cookie })).text()).not.toContain("poster-foot");
  });

  it("strips HTML from fields", () => {
    expect(stripHtml('<script>alert(1)</script>Café <img src=x onerror=1>"Bar"', 100)).toBe('alert(1)Café "Bar"');
    expect(stripHtml("a<b", 100)).toBe("a");
    expect(stripHtml("x".repeat(300), 120)).toHaveLength(120);
  });
});
