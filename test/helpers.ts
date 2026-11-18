import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import app from "../src/index";
import { hashPin, newId } from "../src/lib/crypto";
export { devOutbox } from "../src/lib/email";

export const ORIGIN = "https://cards.example.com";
let ipCounter = 0;
export const uniqueIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export async function call(path: string, init: RequestInit & { cookie?: string; json?: unknown; ip?: string; vars?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.ip) headers.set("CF-Connecting-IP", init.ip);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.method && init.method !== "GET" && !headers.has("Origin")) headers.set("Origin", ORIGIN);
  // Call the app directly (same module instance as the test, so the dev
  // email outbox is shared) and wait for any waitUntil work to finish.
  const ctx = createExecutionContext();
  const e = init.vars ? { ...env, ...init.vars } : env;
  const res = await app.fetch(new Request(ORIGIN + path, { ...init, headers, body, redirect: "manual" }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function cookieFrom(res: Response, name: string): string | null {
  for (const sc of res.headers.getSetCookie()) {
    const m = sc.match(new RegExp(`^${name}=([^;]*)`));
    if (m) return `${name}=${m[1]}`;
  }
  return null;
}

/** Ensure the shop exists (it's created lazily on first request). */
export async function warm() {
  await call("/privacy");
}

export async function makeStaff(role: "owner" | "barista" = "barista", pin = "1234") {
  await warm();
  const id = newId();
  await env.DB.prepare(`INSERT INTO staff (id, shop_id, name, pin_hash, role, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .bind(id, env.SHOP_ID, `${role}-${id.slice(0, 4)}`, await hashPin(pin, 1000), role, Date.now())
    .run();
  const res = await call("/api/staff/login", { method: "POST", json: { staffId: id, pin }, ip: uniqueIp() });
  if (res.status !== 200) throw new Error(`login failed ${res.status}`);
  return { id, cookie: cookieFrom(res, "sc_staff")! };
}

export async function newCard(ip = uniqueIp()) {
  const res = await call("/join?new=1", { ip });
  const secretId = res.headers.get("Location")!.split("/card/")[1];
  const row = await env.DB.prepare(`SELECT id, scan_code FROM cards WHERE secret_id = ?`).bind(secretId).first<{ id: string; scan_code: string }>();
  return { id: row!.id, secretId, scanCode: row!.scan_code, cookie: cookieFrom(res, `sc_card_${env.SHOP_ID}`)! };
}

export async function stamp(cookie: string, scanCode: string, amount: number, idempotencyKey?: string) {
  const res = await call("/api/staff/stamp", { method: "POST", cookie, json: { scanCode, amount, idempotencyKey } });
  return { status: res.status, body: (await res.json()) as any };
}

export async function setStamps(secretId: string, stamps: number) {
  await env.DB.prepare(`UPDATE cards SET stamps = ?, version = version + 1 WHERE secret_id = ?`).bind(stamps, secretId).run();
}
