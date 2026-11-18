#!/usr/bin/env node
// Fills your LOCAL database with a demo shop and sample cards, for screenshots
// and trying things out. It only ever touches the local database used by
// `npm run dev`; there is no way to point it at a real deploy.
//
//   npm run seed
//
// Then open http://localhost:8787/staff/login (Owner PIN 1234, Barista PIN 1111).
import { execFileSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (process.argv.some((a) => /remote|prod/i.test(a))) {
  console.error("The demo seed only runs against the local database.");
  process.exit(1);
}
if (!existsSync("wrangler.toml")) {
  console.error("No wrangler.toml yet. Run: cp wrangler.toml.example wrangler.toml");
  process.exit(1);
}
const toml = readFileSync("wrangler.toml", "utf8");
const SHOP = toml.match(/^\s*SHOP_ID\s*=\s*"([^"]+)"/m)?.[1] || "main";

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const rand = (alphabet, n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => alphabet[b % alphabet.length]).join("");
const id = () => rand(B62, 20);
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hashPin(pin, iterations = 100_000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}
const q = (v) => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const now = Date.now();
const DAY = 86_400_000;
const owner = { id: id(), name: "Owner", pin: "1234", role: "owner" };
const barista = { id: id(), name: "Barista", pin: "1111", role: "barista" };

// Start from an empty local database every time.
const tables = ["broadcast_views", "broadcasts", "events", "email_tokens", "sessions", "cards", "staff", "shop_logos", "shop_stamp_icons", "rate_limits", "shops"];
const sql = tables.map((t) => `DELETE FROM ${t};`);
sql.push(
  `INSERT INTO shops (id, name, stamps_required, reward_label, logo_url, theme, timezone, created_at, primary_colour, secondary_colour, text_colour, broadcast_bg, needs_brand_colours)
   VALUES (${q(SHOP)}, 'Demo Shop', 8, 'Free drink', NULL, '{"stampIcon":"cup","venueType":"coffee"}', 'Europe/London', ${now - 60 * DAY}, '#2F6FED', '#0B1F4B', '#FFFFFF', 'secondary', 0);`,
);
for (const s of [owner, barista]) {
  sql.push(
    `INSERT INTO staff (id, shop_id, name, pin_hash, role, active, created_at) VALUES (${q(s.id)}, ${q(SHOP)}, ${q(s.name)}, ${q(await hashPin(s.pin))}, ${q(s.role)}, 1, ${now - 60 * DAY});`,
  );
}
const cards = [];
const stampCounts = [0, 1, 2, 3, 5, 7, 8, 4, 6, 2, 1, 3];
for (let i = 0; i < stampCounts.length; i++) {
  const card = { id: id(), secret: rand(B62, 24), scan: rand(B32, 10), stamps: stampCounts[i], rewards: i % 4 === 0 ? 1 : 0 };
  cards.push(card);
  const created = now - (40 - i * 3) * DAY;
  sql.push(
    `INSERT INTO cards (id, secret_id, scan_code, shop_id, stamps, rewards_redeemed, version, created_at, last_seen_at) VALUES (${q(card.id)}, ${q(card.secret)}, ${q(card.scan)}, ${q(SHOP)}, ${card.stamps}, ${card.rewards}, ${card.stamps + card.rewards}, ${created}, ${now - (i % 5) * DAY});`,
  );
  for (let s = 0; s < card.stamps + card.rewards * 8; s++) {
    const staff = s % 2 ? barista : owner;
    sql.push(
      `INSERT INTO events (id, shop_id, card_id, staff_id, type, amount, created_at) VALUES (${q(id())}, ${q(SHOP)}, ${q(card.id)}, ${q(staff.id)}, 'stamp', 1, ${now - ((s * 3 + i) % 13) * DAY - s * 3_600_000});`,
    );
  }
  if (card.rewards) {
    sql.push(`INSERT INTO events (id, shop_id, card_id, staff_id, type, amount, created_at) VALUES (${q(id())}, ${q(SHOP)}, ${q(card.id)}, ${q(owner.id)}, 'redeem', 8, ${now - 2 * DAY});`);
  }
}
sql.push(
  `INSERT INTO broadcasts (id, shop_id, message, starts_at, ends_at, ended_at, created_by, created_at) VALUES (${q(id())}, ${q(SHOP)}, 'Double stamps every Friday this month!', ${now - DAY}, NULL, NULL, ${q(owner.id)}, ${now - DAY});`,
);

mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/seed-demo.sql", `${sql.join("\n")}\n`);
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { stdio: "inherit" });
wrangler("d1", "migrations", "apply", "DB", "--local");
wrangler("d1", "execute", "DB", "--local", "--file", ".wrangler/seed-demo.sql");
console.log(`
Demo shop ready (local only). Start it with: npm run dev
  Staff login:  http://localhost:8787/staff/login   Owner PIN 1234 · Barista PIN 1111
  Sample cards:
${cards
  .slice(0, 5)
  .map((c) => `    http://localhost:8787/card/${c.secret}   (${c.stamps} stamp${c.stamps === 1 ? "" : "s"})`)
  .join("\n")}
`);
