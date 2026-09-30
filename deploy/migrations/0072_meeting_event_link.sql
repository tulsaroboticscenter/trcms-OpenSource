-- Tie a meeting's minutes to the scheduled event (e.g. the YLC meeting event).
ALTER TABLE meetings
  ADD COLUMN event_id INT NULL AFTER group_label;

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0072_meeting_event_link', NOW());
