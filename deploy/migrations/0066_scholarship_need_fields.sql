-- Additional need-assessment fields on scholarship applications. The "category"
-- (needs-based tenure) reuses the existing choose_one column.
ALTER TABLE scholarship_applications
  ADD COLUMN need_explanation TEXT        NULL AFTER narrative,
  ADD COLUMN household_size   INT         NULL AFTER choose_one,
  ADD COLUMN youth_count      INT         NULL AFTER household_size,
  ADD COLUMN frl_eligible     VARCHAR(10) NULL AFTER youth_count,
  ADD COLUMN certified        TINYINT(1)  NOT NULL DEFAULT 0 AFTER frl_eligible;

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0066_scholarship_need_fields', NOW());
