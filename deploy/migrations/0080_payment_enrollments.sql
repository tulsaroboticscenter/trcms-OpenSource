-- 0080 — Combined enrollment payments: one online payment can settle several of
-- a youth's enrollments (e.g. FTC + FRC) in a single transaction. This link
-- table records which enrollments a payment covers and each one's share, so the
-- return/webhook can mark every covered enrollment paid with the right amount.

CREATE TABLE IF NOT EXISTS payment_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  enrollment_id INT NOT NULL,
  base_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  INDEX idx_pe_payment (payment_id),
  INDEX idx_pe_enrollment (enrollment_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0080', NOW());
