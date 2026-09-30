-- 0089 — Season Plan enhancements (Release 3.5).
--  #121: activities gain a start_date and duration_days alongside the existing
--        target_date (relabeled "Target Due Date" in the UI). Any two of
--        (start, target, duration) determine the third.
--  #122: activities gain percent_complete (0–100); category/plan completion is
--        rolled up from the activities.

ALTER TABLE season_activities
  ADD COLUMN start_date       DATE NULL      AFTER description,
  ADD COLUMN duration_days    INT  NULL      AFTER start_date,
  ADD COLUMN percent_complete TINYINT NOT NULL DEFAULT 0 AFTER status;

-- Backfill: activities already marked done read as 100% complete.
UPDATE season_activities SET percent_complete = 100 WHERE status = 'done';

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0089', NOW());
