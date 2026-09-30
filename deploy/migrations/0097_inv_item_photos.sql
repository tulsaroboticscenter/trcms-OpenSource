-- 0097 — Multiple photos per inventory item (assets). Photos are uploaded via
-- /api/v1/uploads/photo (stored under public/uploads) and referenced here so an
-- asset can carry a gallery of images. Deleting the item removes its photo rows.

CREATE TABLE IF NOT EXISTS inv_item_photos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  item_id       INT NOT NULL,
  url           VARCHAR(500) NOT NULL,
  caption       VARCHAR(200) NULL,
  display_order INT NOT NULL DEFAULT 0,
  uploaded_by   INT NULL,
  created_at    DATETIME NULL,
  KEY idx_iip_item (item_id, display_order),
  CONSTRAINT fk_iip_item FOREIGN KEY (item_id)     REFERENCES inv_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_iip_user FOREIGN KEY (uploaded_by) REFERENCES members(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0097', NOW());
