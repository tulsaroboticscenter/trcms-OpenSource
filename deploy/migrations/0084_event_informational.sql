-- 0084_event_informational.sql — "info events": calendar entries that are purely
-- informational (announcements, deadlines, reminders) and must NOT be checked into.
-- They render on the main calendar and on the calendars of any teams they're tagged
-- to (via event_team_links), like a holiday — but they are real events, so they keep
-- details, date ranges, and team links. Excluded from the check-in station's event list.

ALTER TABLE events
  ADD COLUMN is_informational TINYINT(1) NOT NULL DEFAULT 0 AFTER event_type;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0084_event_informational', NOW());
