-- Stamp Card v1 – custom stamp icon upload (kept in D1 like the logo).
CREATE TABLE shop_stamp_icons (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id),
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Brand presets are gone; colours live only in the shops row.
UPDATE shops SET needs_brand_colours = 0;
