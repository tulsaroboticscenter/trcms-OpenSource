-- Prevent a member from ever having more than one OPEN check-in at a time.
-- The check-in toggle already looks for an open check-in before inserting, but two
-- near-simultaneous requests (a kiosk double-tap, or the member + a mentor checking
-- them in at once) can both pass that check and each insert an open row. Only a
-- database-level guard closes that race for good.

-- 1. Resolve any existing duplicate OPEN check-ins first, or the unique index can't be
--    added: keep the EARLIEST open per member and close the rest at their own time_in
--    (0 minutes, so no logged time is inflated). The derived table is materialised, so
--    this is safe to run against the same table.
UPDATE checkins c
  JOIN (SELECT member_id, MIN(id) AS keep_id
          FROM checkins
         WHERE time_out IS NULL
         GROUP BY member_id) k
    ON k.member_id = c.member_id
   SET c.time_out = c.time_in
 WHERE c.time_out IS NULL AND c.id <> k.keep_id;

-- 2. A generated column that equals the member_id only while the check-in is OPEN
--    (NULL once checked out), plus a UNIQUE index on it. That allows at most one open
--    check-in per member; NULLs repeat freely, so any number of CLOSED check-ins are
--    unaffected. Works on MySQL 5.7+/8+ and MariaDB 10.2+.
ALTER TABLE checkins
  ADD COLUMN open_member_id INT AS (IF(time_out IS NULL, member_id, NULL)) VIRTUAL;
ALTER TABLE checkins
  ADD UNIQUE KEY uq_checkins_open_member (open_member_id);
