import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { newToken, sha256Hex } from "./lib/crypto";
import type { AppEnv, StaffRow, StaffSession } from "./types";

export const STAFF_COOKIE = "sc_staff";
export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

export function cardCookieName(shopId: string) {
  return `sc_card_${shopId}`;
}

export function setCardCookie(c: Context<AppEnv>, secretId: string) {
  setCookie(c, cardCookieName(c.var.shop.id), secretId, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: 400 * 86_400, // browsers cap at 400 days
  });
}

export async function createSession(c: Context<AppEnv>, staff: StaffRow) {
  const token = newToken();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, staff_id, created_at, expires_at, last_used_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(await sha256Hex(token), staff.id, now, now + SESSION_DAYS * DAY_MS, now, (c.req.header("User-Agent") || "").slice(0, 200))
    .run();
  setCookie(c, STAFF_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession(c: Context<AppEnv>) {
  const s = c.var.session;
  if (s) await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(s.sessionId).run();
  deleteCookie(c, STAFF_COOKIE, { path: "/", secure: true });
}

/** Loads the staff session (if any) into c.var.session. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("session", null);
  const token = getCookie(c, STAFF_COOKIE);
  if (token && token.length <= 64) {
    const id = await sha256Hex(token);
    const now = Date.now();
    const staff = await c.env.DB.prepare(
      `SELECT st.*, s.last_used_at AS s_last_used FROM sessions s JOIN staff st ON st.id = s.staff_id
       WHERE s.id = ? AND s.expires_at > ? AND st.active = 1 AND st.shop_id = ?`,
    )
      .bind(id, now, c.var.shop.id)
      .first<StaffRow & { s_last_used: number | null }>();
    if (staff) {
      c.set("session", { sessionId: id, staff } satisfies StaffSession);
      // Touch at most hourly to save writes.
      if (!staff.s_last_used || now - staff.s_last_used > 3_600_000) {
        c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`).bind(now, id).run());
      }
    }
  }
  await next();
};

/** Same-origin check for every state-changing request. */
export const checkOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (!origin || origin !== new URL(c.req.url).origin) {
      return c.json({ ok: false, code: "BAD_ORIGIN", message: "Request blocked." }, 403);
    }
  }
  await next();
};

export const requireStaffApi: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.session) return c.json({ ok: false, code: "UNAUTHENTICATED", message: "Please log in again." }, 401);
  await next();
};

export const requireOwnerApi: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.var.session) return c.json({ ok: false, code: "UNAUTHENTICATED", message: "Please log in again." }, 401);
  if (c.var.session.staff.role !== "owner") return c.json({ ok: false, code: "FORBIDDEN", message: "Owner only." }, 403);
  await next();
};

/** Safe local redirect target. */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/staff";
  return next;
}
