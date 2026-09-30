-- 0103 — Repair costs. Track the cost of a repair (labor/service) and a BOM of
-- replacement parts (each a line with quantity + unit cost, optionally linked to
-- an inventory item). Total repair cost = parts subtotal + repair_cost.

ALTER TABLE repair_tickets
  ADD COLUMN repair_cost DECIMAL(10,2) NULL AFTER resolution;

CREATE TABLE IF NOT EXISTS repair_parts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id    INT NOT NULL,
  inv_item_id  INT NULL,
  part_name    VARCHAR(200) NOT NULL,
  quantity     DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_cost    DECIMAL(10,2) NULL,
  notes        VARCHAR(300) NULL,
  created_at   DATETIME NULL,
  KEY idx_rp_ticket (ticket_id),
  CONSTRAINT fk_rp_ticket FOREIGN KEY (ticket_id)   REFERENCES repair_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_item   FOREIGN KEY (inv_item_id) REFERENCES inv_items(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0103', NOW());
