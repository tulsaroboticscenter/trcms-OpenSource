-- 0209 — "TRC Volunteer" (YPT-required) designation (#182). A per-adult flag marking a
-- volunteer or parent who is around youth regularly and must meet the same YPT +
-- background-check compliance as a mentor — as opposed to a one-off "event volunteer".
-- Effective requirement = member_type='mentor' OR requires_ypt=1 (mentors are always
-- required via their type, so this flag is for the extra adults). No backfill needed.
ALTER TABLE members ADD COLUMN requires_ypt TINYINT(1) NOT NULL DEFAULT 0;
INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0209_requires_ypt', NOW());
