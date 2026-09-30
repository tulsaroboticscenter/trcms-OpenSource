-- 0220 — "When do you need this by?" on a BOM. The team can mark ASAP / No Rush, or give a
-- specific date, so the purchaser knows the urgency. needed_by holds the mode
-- ('asap' | 'no_rush' | 'date' | NULL = no preference); needed_by_date holds the date when
-- needed_by = 'date'.
ALTER TABLE inv_boms
  ADD COLUMN needed_by      VARCHAR(16) NULL AFTER notes,
  ADD COLUMN needed_by_date DATE        NULL AFTER needed_by;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0220_bom_needed_by', NOW());
