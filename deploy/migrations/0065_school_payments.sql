-- Third-party (school / activity-fund) payments toward a youth's registration.
-- Applying reduces the youth's enrollment amount_due (family owes less) and
-- creates a receivable from the school that we invoice. Reversible.
CREATE TABLE IF NOT EXISTS school_payments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  school_id      INT           NOT NULL,          -- schools.id (e.g. Epic Charter)
  member_id      INT           NULL,              -- the youth
  enrollment_id  INT           NULL,              -- the enrollment it reduced
  amount         DECIMAL(10,2) NOT NULL,
  status         VARCHAR(20)   NOT NULL DEFAULT 'pledged', -- pledged|invoiced|paid|reversed
  note           VARCHAR(300)  NULL,
  invoiced_at    DATETIME      NULL,
  paid_at        DATETIME      NULL,
  created_by_id  INT           NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_at    DATETIME      NULL,
  INDEX idx_school_pay_school (school_id, status),
  INDEX idx_school_pay_enrollment (enrollment_id),
  INDEX idx_school_pay_member (member_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0065_school_payments', NOW());
