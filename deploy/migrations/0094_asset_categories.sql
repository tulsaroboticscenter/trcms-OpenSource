-- 0094 — Asset Categories. A separate categorization for assets (tagged &
-- non-tagged), independent of the inventory catalog categories. e.g.
-- "Electronic Assets" (computers, monitors, iPads, TVs) and "Robot Assets"
-- (control hubs, expansion hubs, drive stations, PDMs). Assigned per item via
-- inv_items.asset_category_id.

CREATE TABLE IF NOT EXISTS asset_categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NULL,
  UNIQUE KEY uq_asset_cat_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE inv_items
  ADD COLUMN asset_category_id INT NULL AFTER category_id,
  ADD CONSTRAINT fk_inv_asset_cat FOREIGN KEY (asset_category_id) REFERENCES asset_categories(id) ON DELETE SET NULL;

INSERT IGNORE INTO asset_categories (name, sort_order, created_at) VALUES
  ('Electronic Assets', 10, NOW()),
  ('Robot Assets', 20, NOW());

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0094', NOW());
