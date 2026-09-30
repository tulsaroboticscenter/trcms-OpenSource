-- 0100 — Allow equipment checkouts for free-text items that aren't in inventory
-- (e.g. an assembled robot, a borrowed tool). item_id becomes optional and, when
-- null, custom_item_name holds the item label. Inventory-backed checkouts are
-- unchanged (still adjust stock) while free-text ones never touch inventory.

ALTER TABLE inv_checkouts
  MODIFY COLUMN item_id INT NULL,
  ADD COLUMN custom_item_name VARCHAR(200) NULL AFTER item_id;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0100', NOW());
