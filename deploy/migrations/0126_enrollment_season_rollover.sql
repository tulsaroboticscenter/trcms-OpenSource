-- 0126_enrollment_season_rollover.sql
-- Season-transition bulk enrollment creation (Release 3.12).
--
-- At the season rollover, admins can now create the new season's youth
-- enrollments in one reviewed pass instead of hand-building each one. Those
-- auto-created rows start as status='pending' (a roster placeholder that is NOT
-- yet a confirmed/active member) and auto-promote to a real enrollment once the
-- family has completed it: payment satisfied + annual T&C fully signed + shirt
-- size entered.
--
-- 'status' is a free varchar, so 'pending' needs no column change. We add two
-- marker columns so the batch can be identified (and, if needed, rolled back)
-- and so reports can tell auto-created placeholders from hand-entered rows.

ALTER TABLE enrollments
  ADD COLUMN auto_created_at   DATETIME NULL AFTER updated_at,
  ADD COLUMN auto_created_by_id INT     NULL AFTER auto_created_at;

-- Speeds up the pending/promotion and per-season rollover lookups.
CREATE INDEX idx_enrollments_year_status ON enrollments (enrollment_year, status);
