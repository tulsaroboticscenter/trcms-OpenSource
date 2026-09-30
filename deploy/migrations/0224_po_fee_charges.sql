-- 0224 — Record shipping & tax charged from a purchase order to team budgets. Fees can be split
-- across the teams on a PO in proportion to what each ordered; this table stores what was applied
-- to each budget category so the charge is reversible and can be recomputed without double-counting.
CREATE TABLE IF NOT EXISTS inv_po_fee_charges (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  po_id              INT NOT NULL,
  budget_category_id INT NOT NULL,
  shipping_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  charged_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  actor_id           INT NULL,
  UNIQUE KEY uq_po_category (po_id, budget_category_id),
  KEY idx_po (po_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0224_po_fee_charges', NOW());
