-- 0060_backfill_waitlist_program.sql — one-time data fix. The first waitlist
-- import attached entries to existing mailing-list prospects but did not copy the
-- program onto the visitor record (many mailing-list rows had a blank program), so
-- those waitlisted prospects show no Program of Interest. Backfill it from their
-- waitlist entry where the visitor's program is still blank.

UPDATE visitors v
JOIN waitlist_entries w ON w.visitor_id = v.id AND w.program_id IS NOT NULL
SET v.program_interest_id = w.program_id
WHERE v.program_interest_id IS NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0060_backfill_waitlist_program', NOW());
