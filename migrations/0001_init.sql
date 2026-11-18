-- Stamp Card – initial schema

CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stamps_required INTEGER NOT NULL DEFAULT 10,
  reward_label TEXT NOT NULL DEFAULT 'Free drink',
  max_stamps_per_scan INTEGER NOT NULL DEFAULT 5,
  max_stamps_per_day INTEGER NOT NULL DEFAULT 10,
  brand_colour TEXT,                    -- primary brand colour (hex)
  logo_url TEXT,
  theme TEXT NOT NULL DEFAULT '{}',     -- JSON: accent, ink, background, fonts, stamp icon…
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  created_at INTEGER NOT NULL
);

-- Uploaded logo (kept in D1 so no R2 bucket is needed)
CREATE TABLE shop_logos (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,            -- secretId
  scan_code TEXT UNIQUE NOT NULL, -- public code in the QR
  shop_id TEXT NOT NULL REFERENCES shops(id),
  stamps INTEGER NOT NULL DEFAULT 0,
  rewards_redeemed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0, -- bumps on every change, used by polling
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX cards_shop ON cards(shop_id, last_seen_at);

CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','barista')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX staff_shop ON staff(shop_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,            -- SHA-256 of the session token (token itself is only in the cookie)
  staff_id TEXT NOT NULL REFERENCES staff(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  user_agent TEXT
);
CREATE INDEX sessions_staff ON sessions(staff_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  type TEXT NOT NULL CHECK (type IN ('stamp','redeem','undo')),
  amount INTEGER NOT NULL,
  undoes_event_id TEXT UNIQUE,    -- an event can only be undone once
  idem_key TEXT UNIQUE,           -- stops double-taps counting twice
  created_at INTEGER NOT NULL
);
CREATE INDEX events_card ON events(card_id, created_at);
CREATE INDEX events_shop ON events(shop_id, created_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
