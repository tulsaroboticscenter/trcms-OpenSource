-- 0049_first_annual_compliance.sql
-- Adds an ANNUAL "FIRST registration" compliance type alongside the existing
-- 2-year YPT and background-check tracking. FIRST registration renews every
-- season; prior-season records are retained (mentor_compliance_records already
-- carries enrollment_year + full history, and compliance_type is a free varchar,
-- so records need no schema change — only the adult_roles "current" flags do).

ALTER TABLE adult_roles
  ADD COLUMN first_complete TINYINT(1) NULL AFTER background_check_date,
  ADD COLUMN first_date DATE NULL AFTER first_complete;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0049_first_annual_compliance', NOW());
