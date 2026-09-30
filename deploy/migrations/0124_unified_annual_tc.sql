-- 0124_unified_annual_tc.sql
-- #4: store the annual TRC T&C the same way for EVERYONE. Mentors already use
-- member_annual_tc (one signature per member/year). Youth need two signatures
-- (the youth's own + a parent/guardian's), which lived on the enrollments table.
-- Add a parent-signature pair to member_annual_tc so all annual T&C lives in one
-- per-season table, then backfill the youth/parent history from enrollments.
--
-- member_annual_tc.signed_at/signed_by_id = the member's own signature
--   (mentor/volunteer, or the youth's own signature).
-- parent_signed_at/parent_signed_by_id  = the guardian signature (youth only).

ALTER TABLE member_annual_tc
  ADD COLUMN parent_signed_at    DATETIME NULL AFTER signed_by_id,
  ADD COLUMN parent_signed_by_id INT NULL AFTER parent_signed_at;

-- One member_annual_tc row per (member, enrollment_year). Enrollments can have
-- multiple rows per member/year (FTC + FRC); collapse to the earliest signatures.
INSERT INTO member_annual_tc (member_id, enrollment_year, signed_at, signed_by_id, parent_signed_at, parent_signed_by_id)
SELECT e.member_id, e.enrollment_year,
       MIN(CASE WHEN e.tc_youth_agreed  = 1 THEN e.tc_youth_date  END)  AS signed_at,
       e.member_id                                                       AS signed_by_id,
       MIN(CASE WHEN e.tc_parent_agreed = 1 THEN e.tc_parent_date END)  AS parent_signed_at,
       NULL                                                              AS parent_signed_by_id
  FROM enrollments e
 WHERE (e.tc_youth_agreed = 1 OR e.tc_parent_agreed = 1)
   AND NOT EXISTS (
       SELECT 1 FROM member_annual_tc t
        WHERE t.member_id = e.member_id AND t.enrollment_year = e.enrollment_year)
 GROUP BY e.member_id, e.enrollment_year;
