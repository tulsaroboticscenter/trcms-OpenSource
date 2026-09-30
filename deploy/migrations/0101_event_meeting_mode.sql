-- 0101 — Event meeting mode. Show whether an event is in person, remote, or both,
-- with the remote join link/details surfaced at the top of the event.

ALTER TABLE events
  ADD COLUMN meeting_mode ENUM('in_person','remote','hybrid') NOT NULL DEFAULT 'in_person' AFTER location,
  ADD COLUMN remote_url VARCHAR(500) NULL AFTER meeting_mode,
  ADD COLUMN remote_details VARCHAR(300) NULL AFTER remote_url;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0101', NOW());
