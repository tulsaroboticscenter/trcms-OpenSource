-- Generalize the quick-attendance (FLL) kiosk's program scope.
-- Previously FllAttendanceController hardcoded program_id IN (1,2), which only
-- works when FLL Explore/Challenge happen to be ids 1 and 2. This makes it a
-- per-program flag any organization can set in Admin -> Program Management, so
-- the attendance kiosk works for whichever programs an org chooses (not just FLL,
-- and regardless of program ids on that install).
ALTER TABLE programs ADD COLUMN quick_attendance TINYINT(1) NOT NULL DEFAULT 0;

-- Preserve current behavior for existing installs: FLL Explore + Challenge use it.
-- By NAME (not id) so it's correct no matter what ids this database assigned.
UPDATE programs SET quick_attendance = 1 WHERE name IN ('FLLe', 'FLLc');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0237_programs_quick_attendance', NOW());
