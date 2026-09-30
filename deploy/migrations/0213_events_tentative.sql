-- 0213 — Tentative events. A flag to mark an event as "may not actually happen" so it can
-- appear on the calendar while making clear it isn't confirmed. Default 0 (confirmed).
ALTER TABLE events ADD COLUMN is_tentative TINYINT(1) NOT NULL DEFAULT 0;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0213_events_tentative', NOW());
