-- Amendment 1 – optional email card recovery

-- The card's secret now lives in its own column so it can be rotated on
-- recovery. cards.id stays as a stable internal id that events point to.
-- (Existing cards keep their current secret: secret_id = id.)
ALTER TABLE cards ADD COLUMN secret_id TEXT;
UPDATE cards SET secret_id = id;
CREATE UNIQUE INDEX cards_secret ON cards(secret_id);

ALTER TABLE cards ADD COLUMN email TEXT;
ALTER TABLE cards ADD COLUMN email_verified_at INTEGER;
ALTER TABLE cards ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cards ADD COLUMN marketing_opt_in_at INTEGER;
ALTER TABLE cards ADD COLUMN retired_at INTEGER;
CREATE UNIQUE INDEX cards_shop_email ON cards(shop_id, email) WHERE email_verified_at IS NOT NULL AND retired_at IS NULL;
CREATE INDEX cards_email ON cards(email);

CREATE TABLE email_tokens (
  token_hash TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id),
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify','recover')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX email_tokens_card ON email_tokens(card_id);

-- Recreate events: SQLite can't alter a CHECK constraint.
--  * new types: merge, adjust, email_added, email_removed, recovered,
--    recovery_sent, deleted
--  * staff_id is nullable: customer actions (merge, recovery) have no staff
--  * note: reason for owner stamp adjustments
CREATE TABLE events_new (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  staff_id TEXT REFERENCES staff(id),
  type TEXT NOT NULL CHECK (type IN ('stamp','redeem','undo','merge','adjust','email_added','email_removed','recovered','recovery_sent','deleted')),
  amount INTEGER NOT NULL,
  undoes_event_id TEXT UNIQUE,
  idem_key TEXT UNIQUE,
  note TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO events_new (id, shop_id, card_id, staff_id, type, amount, undoes_event_id, idem_key, created_at)
  SELECT id, shop_id, card_id, staff_id, type, amount, undoes_event_id, idem_key, created_at FROM events ORDER BY rowid;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_card ON events(card_id, created_at);
CREATE INDEX events_shop ON events(shop_id, created_at);
