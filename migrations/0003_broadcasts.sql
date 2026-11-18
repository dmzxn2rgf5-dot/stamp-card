-- Amendment 2 – broadcast offers + three brand colours

ALTER TABLE shops ADD COLUMN primary_colour TEXT NOT NULL DEFAULT '#2F6FED';
ALTER TABLE shops ADD COLUMN secondary_colour TEXT NOT NULL DEFAULT '#0B1F4B';
ALTER TABLE shops ADD COLUMN text_colour TEXT NOT NULL DEFAULT '#FFFFFF';
ALTER TABLE shops ADD COLUMN broadcast_bg TEXT NOT NULL DEFAULT 'secondary'
  CHECK (broadcast_bg IN ('primary','secondary'));
-- 1 = fill the three colours from this deploy's brand preset on next load
-- (the migration can't see the brand files, and the generic defaults
-- above would otherwise overwrite an existing shop's branding).
ALTER TABLE shops ADD COLUMN needs_brand_colours INTEGER NOT NULL DEFAULT 1;

-- Copy any owner-chosen brand_colour into primary_colour; brand_colour is no longer used.
UPDATE shops SET primary_colour = brand_colour WHERE brand_colour IS NOT NULL;

CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  message TEXT NOT NULL CHECK (length(message) <= 280),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  ended_at INTEGER,
  created_by TEXT NOT NULL REFERENCES staff(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX broadcasts_shop ON broadcasts(shop_id, created_at);

CREATE TABLE broadcast_views (
  broadcast_id TEXT NOT NULL REFERENCES broadcasts(id),
  card_id TEXT NOT NULL REFERENCES cards(id),
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (broadcast_id, card_id)
);
