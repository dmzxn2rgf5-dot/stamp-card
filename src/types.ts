export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Stable id stored on every record. One deploy = one shop. Default "main". */
  SHOP_ID?: string;
  TIMEZONE?: string;
  /** Secret: unlocks the first-run setup wizard at /setup?token=… */
  SETUP_TOKEN?: string;
  /** "on" switches on email card recovery (needs Workers Paid + Email Service). Default off. */
  EMAIL_RECOVERY?: string;
  /** Public address of this deploy, e.g. https://cards.example.com. Used in QR codes and emails. */
  PUBLIC_URL?: string;
  /** Cloudflare Email Service send binding (optional until a domain is onboarded). */
  EMAIL?: SendEmail;
  /** Sender address on the owner's onboarded domain. */
  EMAIL_FROM?: string;
  /** "1" = don't send, just log emails to the console (local dev / tests). */
  EMAIL_DEV_LOG?: string;
}

export interface ShopRow {
  id: string;
  name: string;
  stamps_required: number;
  reward_label: string;
  max_stamps_per_scan: number;
  max_stamps_per_day: number;
  brand_colour: string | null; // legacy, replaced by primary_colour (Amendment 2)
  primary_colour: string;
  secondary_colour: string;
  text_colour: string;
  broadcast_bg: "primary" | "secondary";
  needs_brand_colours: number;
  logo_url: string | null;
  theme: string;
  timezone: string;
  created_at: number;
}

export interface CardRow {
  id: string;                 // stable internal id
  secret_id: string;          // bearer secret in the customer's URL/cookie (rotates on recovery)
  scan_code: string;
  shop_id: string;
  stamps: number;
  rewards_redeemed: number;
  version: number;
  created_at: number;
  last_seen_at: number | null;
  email: string | null;
  email_verified_at: number | null;
  marketing_opt_in: number;
  marketing_opt_in_at: number | null;
  retired_at: number | null;
}

export interface StaffRow {
  id: string;
  shop_id: string;
  name: string;
  pin_hash: string;
  role: "owner" | "barista";
  active: number;
  created_at: number;
}

export type EventType =
  | "stamp" | "redeem" | "undo" | "merge" | "adjust"
  | "email_added" | "email_removed" | "recovered" | "recovery_sent" | "deleted";

export interface EventRow {
  id: string;
  shop_id: string;
  card_id: string;
  staff_id: string | null;
  type: EventType;
  amount: number;
  undoes_event_id: string | null;
  idem_key: string | null;
  note: string | null;
  created_at: number;
}

export interface StaffSession {
  sessionId: string;
  staff: StaffRow;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { shop: ShopRow; session: StaffSession | null };
};
