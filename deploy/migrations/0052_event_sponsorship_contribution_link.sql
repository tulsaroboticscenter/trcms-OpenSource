-- 0052_event_sponsorship_contribution_link.sql — link an event-sponsorship
-- pipeline entry to the Sponsors-module contribution it generates on commit, so
-- event dollars flow through the same budget/reporting path as direct sponsor gifts.

ALTER TABLE event_sponsorships ADD COLUMN contribution_id INT NULL AFTER package_id;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0052_event_sponsorship_contribution_link', NOW());
