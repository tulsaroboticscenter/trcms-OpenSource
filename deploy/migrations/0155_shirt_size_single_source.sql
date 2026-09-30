-- Shirt size: one source of truth.
--
-- shirt_size lived on BOTH members and enrollments and the two drifted (registration
-- wrote both; season rollover nulled members but left enrollments). A person has one
-- shirt size but can have several enrollments in a season, so per-enrollment storage
-- was ambiguous as well as duplicative. members.shirt_size is now the sole source; all
-- reads and writes were repointed to it in code.
--
-- STEP 1 — don't lose anything. Most sizes currently live only on enrollments (in dev,
-- 30 enrollment values vs 3 member values). Backfill members.shirt_size from each
-- member's most recent non-empty enrollment size, but only where the member has none
-- (a member value that survived a rollover is this-season-confirmed and wins).
UPDATE members m
   SET m.shirt_size = (
        SELECT e.shirt_size FROM enrollments e
         WHERE e.member_id = m.id AND e.shirt_size IS NOT NULL AND e.shirt_size <> ''
         ORDER BY e.enrollment_year DESC, e.id DESC LIMIT 1)
 WHERE (m.shirt_size IS NULL OR m.shirt_size = '')
   AND EXISTS (SELECT 1 FROM enrollments e2
                WHERE e2.member_id = m.id AND e2.shirt_size IS NOT NULL AND e2.shirt_size <> '');

-- STEP 2 — remove the duplicate column so it can never drift again.
ALTER TABLE enrollments DROP COLUMN shirt_size;
