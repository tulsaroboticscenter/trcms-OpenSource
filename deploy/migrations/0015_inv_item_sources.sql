-- Vendor sources: an inventory item can be bought from more than one vendor,
-- each with its own vendor part number, price, and product URL. The item's
-- existing vendor_id / url / cost remain the "primary" source for backward
-- compatibility; inv_item_sources lists additional (or all) supply options so
-- a purchaser can compare prices. One source per item may be flagged preferred.
CREATE TABLE IF NOT EXISTS inv_item_sources (
  id INT NOT NULL AUTO_INCREMENT,
  item_id INT NOT NULL,
  vendor_id INT NOT NULL,
  vendor_part_number VARCHAR(120) DEFAULT NULL,
  price DECIMAL(12,2) DEFAULT NULL,
  url VARCHAR(500) DEFAULT NULL,
  is_preferred TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(500) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY item_id (item_id),
  KEY vendor_id (vendor_id),
  CONSTRAINT inv_item_sources_ibfk_1 FOREIGN KEY (item_id) REFERENCES inv_items (id) ON DELETE CASCADE,
  CONSTRAINT inv_item_sources_ibfk_2 FOREIGN KEY (vendor_id) REFERENCES inv_vendors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
