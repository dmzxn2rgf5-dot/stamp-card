import type { Env } from "../types";

/** Public address of this deploy: PUBLIC_URL if set, otherwise the request's own origin. */
export function publicOrigin(env: Env, requestUrl: string): string {
  const u = (env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s/]+$/.test(u)) return u;
  return new URL(requestUrl).origin;
}
