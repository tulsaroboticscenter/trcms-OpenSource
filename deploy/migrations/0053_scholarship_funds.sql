-- 0053_scholarship_funds.sql — Scholarships & Youth Support (2.2, phase A)
-- The money-in side: named scholarship funds that donor/sponsor contributions can
-- be earmarked to, plus deductibility labeling. Award/application workflow (which
-- touches minor PII) is a later, admin-restricted slice.

CREATE TABLE IF NOT EXISTS scholarship_funds (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  description   TEXT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_by_id INT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Earmark a contribution to a scholarship fund + record its funding model and
-- deductibility. tax_deductible defaults to 1 (TRC is a 501c3); the named-match
-- model is flagged 0 by the app because gifts earmarked to a specific individual
-- are generally not deductible.
ALTER TABLE sponsor_contributions
  ADD COLUMN scholarship_fund_id INT NULL AFTER designation,
  ADD COLUMN program_model       VARCHAR(20) NULL AFTER scholarship_fund_id,
  ADD COLUMN tax_deductible      TINYINT(1) NOT NULL DEFAULT 1 AFTER program_model;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0053_scholarship_funds', NOW());
