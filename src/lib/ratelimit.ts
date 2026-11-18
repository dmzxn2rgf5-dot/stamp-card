// Fixed-window rate limiter backed by a D1 table. Small and free.

export interface Limit {
  count: number;
  resetAt: number;
}

/** Increment the counter for `key` and return the new count. */
export async function hit(db: D1Database, key: string, windowMs: number, now = Date.now()): Promise<Limit> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number; reset_at: number }>();
  return { count: row!.count, resetAt: row!.reset_at };
}

/** Read the current count without incrementing. */
export async function peek(db: D1Database, key: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(`SELECT count FROM rate_limits WHERE key = ? AND reset_at > ?`)
    .bind(key, now)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function clear(db: D1Database, key: string) {
  await db.prepare(`DELETE FROM rate_limits WHERE key = ?`).bind(key).run();
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
