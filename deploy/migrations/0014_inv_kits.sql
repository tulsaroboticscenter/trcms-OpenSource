-- Kits: an inventory item can be a "kit" — a single purchasable SKU (its own
-- part number) that is really a bundle of individual component parts. The kit
-- itself holds no stock; when received it explodes into its components (handled
-- in the receiving flow). inv_kit_components lists the parts and per-kit quantity.
ALTER TABLE inv_items
  ADD COLUMN is_kit TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inv_kit_components (
  id INT NOT NULL AUTO_INCREMENT,
  kit_item_id INT NOT NULL,
  component_item_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY kit_item_id (kit_item_id),
  KEY component_item_id (component_item_id),
  CONSTRAINT inv_kit_components_ibfk_1 FOREIGN KEY (kit_item_id) REFERENCES inv_items (id) ON DELETE CASCADE,
  CONSTRAINT inv_kit_components_ibfk_2 FOREIGN KEY (component_item_id) REFERENCES inv_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
