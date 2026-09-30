-- FIRST Development Program (FDP) membership.
--
-- Every youth who joins FTC or FRC starts in the FDP and stays in it until they
-- graduate. There is NO fee, so this deliberately does NOT ride on `enrollments`:
-- that table carries amounts due, payment gating, shirt-size requirements and the
-- pending->paid promotion rules, none of which apply here. (Note: two youth already
-- have an FDP row in `enrollments` carrying $240 due — left alone pending review.)
--
-- Tracked PER SEASON: one row per member per enrollment_year, so you can see who was
-- in the program in any given year and when they graduated. Graduation is a one-way
-- door — once a member has graduated in any season, the auto-assign will not put them
-- back in a later one.
--
-- Graduation criteria are not yet defined. `graduated_note` is free text so the
-- reason can be recorded now and formalised later without a schema change.
CREATE TABLE IF NOT EXISTS fdp_memberships (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  member_id        INT NOT NULL,
  enrollment_year  INT NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | graduated
  joined_date      DATE NULL,
  joined_source    VARCHAR(20) NOT NULL DEFAULT 'manual',   -- manual | auto | bulk
  graduated_date   DATE NULL,
  graduated_by_id  INT NULL,
  graduated_note   TEXT NULL,
  notes            TEXT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_member_year (member_id, enrollment_year),
  KEY idx_year_status (enrollment_year, status)
);

-- Managing FDP membership is staff work. Keyed by role NAME; safe to re-run.
-- NOTE: fdp.manage is also added to RESOURCE_DEFAULTS in config/permissions.json as
-- 'none'. A key missing from that map falls through to the permissive DEFAULT_LEVEL
-- and every member would pass the check.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'fdp.manage', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Mentor')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'fdp.manage');
