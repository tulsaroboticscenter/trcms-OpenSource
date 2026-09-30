-- 0079 — Meeting minutes: an agenda prepared ahead of the meeting (separate
-- from 'notes', which are the minutes captured during/after it).

ALTER TABLE meetings
  ADD COLUMN agenda MEDIUMTEXT NULL AFTER title;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0079', NOW());
