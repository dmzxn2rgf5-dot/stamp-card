import { DEFAULTS } from "./defaults";
import { newId, newScanCode, newSecretId } from "./lib/crypto";
import { startOfDay } from "./lib/time";
import type { CardRow, Env, EventRow, EventType, ShopRow, StaffRow } from "./types";

// ── Shops ────────────────────────────────────────────────────

export const shopId = (env: Env) => env.SHOP_ID || "main";

/** Load this deploy's shop, creating it with neutral defaults on first run. */
export async function ensureShop(env: Env): Promise<ShopRow> {
  const id = shopId(env);
  const existing = await env.DB.prepare(`SELECT * FROM shops WHERE id = ?`).bind(id).first<ShopRow>();
  if (existing) return existing;
  const d = DEFAULTS;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO shops (id, name, stamps_required, reward_label, logo_url, theme, timezone, created_at,
       primary_colour, secondary_colour, text_colour, broadcast_bg, needs_brand_colours)
     VALUES (?, ?, ?, ?, NULL, '{}', ?, ?, ?, ?, ?, 'secondary', 0)`,
  )
    .bind(id, d.name, d.stampsRequired, d.rewardLabel, env.TIMEZONE || "Europe/London", Date.now(), d.colours.primary, d.colours.secondary, d.colours.text)
    .run();
  return (await env.DB.prepare(`SELECT * FROM shops WHERE id = ?`).bind(id).first<ShopRow>())!;
}

// ── Cards ────────────────────────────────────────────────────

export interface CardState {
  stamps: number;
  required: number;
  rewardReady: boolean;
  version: number;
  rewardsRedeemed: number;
}

export function cardState(card: Pick<CardRow, "stamps" | "version" | "rewards_redeemed">, shop: ShopRow): CardState {
  return {
    stamps: card.stamps,
    required: shop.stamps_required,
    rewardReady: card.stamps >= shop.stamps_required,
    version: card.version,
    rewardsRedeemed: card.rewards_redeemed,
  };
}

export async function getCardBySecret(db: D1Database, shopId: string, secretId: string) {
  return db
    .prepare(`SELECT * FROM cards WHERE secret_id = ? AND shop_id = ? AND retired_at IS NULL`)
    .bind(secretId, shopId)
    .first<CardRow>();
}

export async function getCardByScanCode(db: D1Database, shopId: string, scanCode: string) {
  return db
    .prepare(`SELECT * FROM cards WHERE scan_code = ? AND shop_id = ? AND retired_at IS NULL`)
    .bind(scanCode, shopId)
    .first<CardRow>();
}

export async function getCardById(db: D1Database, shopId: string, id: string) {
  return db.prepare(`SELECT * FROM cards WHERE id = ? AND shop_id = ? AND retired_at IS NULL`).bind(id, shopId).first<CardRow>();
}

export async function createCard(db: D1Database, shopId: string): Promise<CardRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const card: CardRow = {
      id: newId(),
      secret_id: newSecretId(),
      scan_code: newScanCode(),
      shop_id: shopId,
      stamps: 0,
      rewards_redeemed: 0,
      version: 0,
      created_at: Date.now(),
      last_seen_at: Date.now(),
      email: null,
      email_verified_at: null,
      marketing_opt_in: 0,
      marketing_opt_in_at: null,
      retired_at: null,
    };
    try {
      await db
        .prepare(`INSERT INTO cards (id, secret_id, scan_code, shop_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(card.id, card.secret_id, card.scan_code, shopId, card.created_at, card.last_seen_at)
        .run();
      return card;
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e; // scan code collision: try again
    }
  }
  throw new Error("Could not allocate card");
}

// ── Stamp / redeem / undo ────────────────────────────────────

export const UNDO_WINDOW_MS = 5 * 60_000;
/** Event types that change a card's stamp count (undo only reverses the latest of these). */
const STAMP_CHANGING = `'stamp','redeem','adjust','merge'`;

export type OpResult =
  | { ok: true; state: CardState; eventId: string; type: EventType; amount: number }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429; code: string; message: string };

const fail = (status: 400 | 403 | 404 | 409 | 429, code: string, message: string): OpResult => ({ ok: false, status, code, message });

/** Stamps added today (net of undos) for a card. */
export async function stampsToday(db: D1Database, shop: ShopRow, cardId: string, now = Date.now()): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(e.amount), 0) AS n FROM events e
       WHERE e.card_id = ? AND e.type = 'stamp' AND e.created_at >= ?
         AND NOT EXISTS (SELECT 1 FROM events u WHERE u.undoes_event_id = e.id)`,
    )
    .bind(cardId, startOfDay(shop.timezone, now))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function replayIdempotent(db: D1Database, shop: ShopRow, idemKey: string): Promise<OpResult | null> {
  const ev = await db
    .prepare(`SELECT e.*, c.stamps, c.version, c.rewards_redeemed FROM events e JOIN cards c ON c.id = e.card_id WHERE e.idem_key = ? AND e.shop_id = ?`)
    .bind(idemKey, shop.id)
    .first<EventRow & CardRow>();
  if (!ev) return null;
  return { ok: true, state: cardState(ev, shop), eventId: ev.id, type: ev.type, amount: ev.amount };
}

/**
 * Apply a change to a card atomically. The event row is only inserted
 * if the card is still at `card.version`, and the card is only updated
 * if that event row exists – so two staff members can never overwrite each
 * other and `stamps` and `events` can never drift apart.
 */
async function applyChange(
  db: D1Database,
  card: CardRow,
  ev: { id: string; shopId: string; staffId: string | null; type: EventType; amount: number; undoes?: string; idemKey?: string; note?: string },
  delta: { stamps: number; rewards: number },
): Promise<boolean> {
  const now = Date.now();
  const [, upd] = await db.batch([
    db
      .prepare(
        `INSERT INTO events (id, shop_id, card_id, staff_id, type, amount, undoes_event_id, idem_key, note, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM cards WHERE id = ? AND version = ? AND retired_at IS NULL`,
      )
      .bind(ev.id, ev.shopId, card.id, ev.staffId, ev.type, ev.amount, ev.undoes ?? null, ev.idemKey ?? null, ev.note ?? null, now, card.id, card.version),
    db
      .prepare(
        `UPDATE cards SET stamps = stamps + ?, rewards_redeemed = rewards_redeemed + ?, version = version + 1
         WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM events WHERE id = ?)`,
      )
      .bind(delta.stamps, delta.rewards, card.id, card.version, ev.id),
  ]);
  return upd.meta.changes === 1;
}

const isUnique = (e: unknown) => String(e).includes("UNIQUE");

export async function addStamps(
  db: D1Database,
  shop: ShopRow,
  staff: StaffRow,
  scanCode: string,
  amount: number,
  idemKey?: string,
): Promise<OpResult> {
  if (!Number.isInteger(amount) || amount < 1) return fail(400, "BAD_AMOUNT", "Amount must be at least 1.");
  if (amount > shop.max_stamps_per_scan)
    return fail(400, "OVER_SCAN_LIMIT", `You can give at most ${shop.max_stamps_per_scan} stamps per scan.`);
  if (idemKey) {
    const prior = await replayIdempotent(db, shop, idemKey);
    if (prior) return prior;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const card = await getCardByScanCode(db, shop.id, scanCode);
    if (!card) return fail(404, "NOT_FOUND", "Card not found.");
    const today = await stampsToday(db, shop, card.id);
    if (today + amount > shop.max_stamps_per_day) {
      const left = Math.max(0, shop.max_stamps_per_day - today);
      return fail(
        429,
        "DAILY_LIMIT",
        left === 0
          ? `This card has had its ${shop.max_stamps_per_day} stamps for today.`
          : `Daily limit: this card can only get ${left} more stamp${left === 1 ? "" : "s"} today.`,
      );
    }
    const eventId = newId();
    try {
      const ok = await applyChange(db, card, { id: eventId, shopId: shop.id, staffId: staff.id, type: "stamp", amount, idemKey }, { stamps: amount, rewards: 0 });
      if (ok) {
        const state = cardState({ stamps: card.stamps + amount, version: card.version + 1, rewards_redeemed: card.rewards_redeemed }, shop);
        return { ok: true, state, eventId, type: "stamp", amount };
      }
    } catch (e) {
      if (isUnique(e) && idemKey) {
        const prior = await replayIdempotent(db, shop, idemKey);
        if (prior) return prior;
      }
      throw e;
    }
    // version changed under us – re-read and retry
  }
  return fail(409, "BUSY", "That card is being updated. Please try again.");
}

export async function redeem(db: D1Database, shop: ShopRow, staff: StaffRow, scanCode: string, idemKey?: string): Promise<OpResult> {
  if (idemKey) {
    const prior = await replayIdempotent(db, shop, idemKey);
    if (prior) return prior;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const card = await getCardByScanCode(db, shop.id, scanCode);
    if (!card) return fail(404, "NOT_FOUND", "Card not found.");
    if (card.stamps < shop.stamps_required)
      return fail(409, "NOT_READY", `This card has ${card.stamps} of ${shop.stamps_required} stamps – not ready to redeem yet.`);
    const eventId = newId();
    const amount = shop.stamps_required;
    try {
      const ok = await applyChange(db, card, { id: eventId, shopId: shop.id, staffId: staff.id, type: "redeem", amount, idemKey }, { stamps: -amount, rewards: 1 });
      if (ok) {
        const state = cardState({ stamps: card.stamps - amount, version: card.version + 1, rewards_redeemed: card.rewards_redeemed + 1 }, shop);
        return { ok: true, state, eventId, type: "redeem", amount };
      }
    } catch (e) {
      if (isUnique(e) && idemKey) {
        const prior = await replayIdempotent(db, shop, idemKey);
        if (prior) return prior;
      }
      throw e;
    }
  }
  return fail(409, "BUSY", "That card is being updated. Please try again.");
}

export async function undo(db: D1Database, shop: ShopRow, staff: StaffRow, eventId: string, now = Date.now()): Promise<OpResult> {
  const ev = await db.prepare(`SELECT * FROM events WHERE id = ? AND shop_id = ?`).bind(eventId, shop.id).first<EventRow>();
  if (!ev || (ev.type !== "stamp" && ev.type !== "redeem")) return fail(404, "NOT_FOUND", "Nothing to undo.");
  if (ev.staff_id !== staff.id && staff.role !== "owner") return fail(403, "FORBIDDEN", "Only the person who made this change, or the owner, can undo it.");
  if (now - ev.created_at > UNDO_WINDOW_MS) return fail(409, "UNDO_EXPIRED", "Undo is only available for 5 minutes.");
  const done = await db.prepare(`SELECT id FROM events WHERE undoes_event_id = ?`).bind(ev.id).first();
  if (done) return fail(409, "ALREADY_UNDONE", "This has already been undone.");

  for (let attempt = 0; attempt < 5; attempt++) {
    // Only the most recent change on a card can be undone, so the
    // reversal always lands on the state it was made against.
    const latest = await db
      .prepare(
        `SELECT id FROM events e WHERE card_id = ? AND type IN (${STAMP_CHANGING})
           AND NOT EXISTS (SELECT 1 FROM events u WHERE u.undoes_event_id = e.id)
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(ev.card_id)
      .first<{ id: string }>();
    if (latest?.id !== ev.id) return fail(409, "NOT_LATEST", "The card has changed since then, so this can't be undone.");
    const card = await db.prepare(`SELECT * FROM cards WHERE id = ? AND retired_at IS NULL`).bind(ev.card_id).first<CardRow>();
    if (!card) return fail(404, "NOT_FOUND", "Card not found.");
    const delta = ev.type === "stamp" ? { stamps: -ev.amount, rewards: 0 } : { stamps: ev.amount, rewards: -1 };
    const undoId = newId();
    try {
      const ok = await applyChange(db, card, { id: undoId, shopId: shop.id, staffId: staff.id, type: "undo", amount: ev.amount, undoes: ev.id }, delta);
      if (ok) {
        const state = cardState(
          { stamps: card.stamps + delta.stamps, version: card.version + 1, rewards_redeemed: card.rewards_redeemed + delta.rewards },
          shop,
        );
        return { ok: true, state, eventId: undoId, type: "undo", amount: ev.amount };
      }
    } catch (e) {
      if (isUnique(e)) return fail(409, "ALREADY_UNDONE", "This has already been undone.");
      throw e;
    }
  }
  return fail(409, "BUSY", "That card is being updated. Please try again.");
}

// ── Stats ────────────────────────────────────────────────────

export async function totals(db: D1Database, shopId: string, since: number, staffId?: string) {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN e.type = 'stamp' THEN e.amount END), 0) AS stamps,
         COALESCE(SUM(CASE WHEN e.type = 'redeem' THEN 1 END), 0) AS rewards
       FROM events e
       WHERE e.shop_id = ?1 AND e.created_at >= ?2 AND e.type != 'undo'
         AND (?3 IS NULL OR e.staff_id = ?3)
         AND NOT EXISTS (SELECT 1 FROM events u WHERE u.undoes_event_id = e.id)`,
    )
    .bind(shopId, since, staffId ?? null)
    .first<{ stamps: number; rewards: number }>();
  return { stamps: row?.stamps ?? 0, rewards: row?.rewards ?? 0 };
}

// ── Owner adjustments ────────────────────────────────────────

export async function adjustStamps(db: D1Database, shop: ShopRow, owner: StaffRow, cardId: string, amount: number, reason: string): Promise<OpResult> {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100) return fail(400, "BAD_AMOUNT", "Adjustment must be a whole number between -100 and 100, not 0.");
  if (!reason.trim()) return fail(400, "REASON_REQUIRED", "Give a reason for the adjustment.");
  for (let attempt = 0; attempt < 5; attempt++) {
    const card = await getCardById(db, shop.id, cardId);
    if (!card) return fail(404, "NOT_FOUND", "Card not found.");
    if (card.stamps + amount < 0) return fail(400, "BELOW_ZERO", `The card only has ${card.stamps} stamps.`);
    const eventId = newId();
    const ok = await applyChange(
      db,
      card,
      { id: eventId, shopId: shop.id, staffId: owner.id, type: "adjust", amount, note: reason.trim().slice(0, 200) },
      { stamps: amount, rewards: 0 },
    );
    if (ok) {
      const state = cardState({ stamps: card.stamps + amount, version: card.version + 1, rewards_redeemed: card.rewards_redeemed }, shop);
      return { ok: true, state, eventId, type: "adjust", amount };
    }
  }
  return fail(409, "BUSY", "That card is being updated. Please try again.");
}

/** Log an event that doesn't change stamps (email changes, recovery sent…). */
export async function logEvent(db: D1Database, shopId: string, cardId: string, staffId: string | null, type: EventType, note?: string) {
  await db
    .prepare(`INSERT INTO events (id, shop_id, card_id, staff_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
    .bind(newId(), shopId, cardId, staffId, type, note ?? null, Date.now())
    .run();
}

// ── Recovery ─────────────────────────────────────────────────

/**
 * Restore `card` into a new browser: rotate its secret and scan code so
 * old copies stop working, and fold in the stamps from the browser's
 * previous card (`fromCard`), which is retired. All in one batch, guarded
 * by both cards' versions.
 */
export async function recoverCard(
  db: D1Database,
  shopId: string,
  card: CardRow,
  fromCard: CardRow | null,
): Promise<{ secretId: string; merged: number } | null> {
  const merge = fromCard && fromCard.id !== card.id && fromCard.stamps > 0 ? fromCard : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const now = Date.now();
    const secretId = newSecretId();
    const scanCode = newScanCode();
    const recoveredId = newId();
    const mergeId = newId();
    const stmts: D1PreparedStatement[] = [];
    // Guard event: only inserted if both cards are unchanged since we read them.
    stmts.push(
      db
        .prepare(
          `INSERT INTO events (id, shop_id, card_id, staff_id, type, amount, note, created_at)
           SELECT ?, ?, ?, NULL, 'recovered', 0, NULL, ? FROM cards c
           WHERE c.id = ? AND c.version = ? AND c.retired_at IS NULL
             AND (? IS NULL OR EXISTS (SELECT 1 FROM cards f WHERE f.id = ? AND f.version = ? AND f.retired_at IS NULL))`,
        )
        .bind(recoveredId, shopId, card.id, now, card.id, card.version, merge?.id ?? null, merge?.id ?? null, merge?.version ?? null),
    );
    if (merge) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO events (id, shop_id, card_id, staff_id, type, amount, note, created_at)
             SELECT ?, ?, ?, NULL, 'merge', ?, ?, ? WHERE EXISTS (SELECT 1 FROM events WHERE id = ?)`,
          )
          .bind(mergeId, shopId, card.id, merge.stamps, `from card ${merge.scan_code}`, now + 1, recoveredId),
        db
          .prepare(
            `UPDATE cards SET retired_at = ?, stamps = 0, email = NULL, email_verified_at = NULL, marketing_opt_in = 0,
               marketing_opt_in_at = NULL, version = version + 1
             WHERE id = ? AND EXISTS (SELECT 1 FROM events WHERE id = ?)`,
          )
          .bind(now, merge.id, recoveredId),
      );
    }
    stmts.push(
      db
        .prepare(
          `UPDATE cards SET secret_id = ?, scan_code = ?, stamps = stamps + ?, version = version + 1, last_seen_at = ?
           WHERE id = ? AND EXISTS (SELECT 1 FROM events WHERE id = ?)`,
        )
        .bind(secretId, scanCode, merge?.stamps ?? 0, now, card.id, recoveredId),
    );
    try {
      const res = await db.batch(stmts);
      if (res[0].meta.changes === 1) return { secretId, merged: merge?.stamps ?? 0 };
    } catch (e) {
      if (!isUnique(e)) throw e; // scan code clash: retry with a new one
    }
    const fresh = await getCardById(db, shopId, card.id);
    if (!fresh) return null;
    card = fresh;
    if (merge) {
      const f = await getCardById(db, shopId, merge.id);
      if (!f) return recoverCard(db, shopId, card, null);
      Object.assign(merge, f);
    }
  }
  return null;
}
