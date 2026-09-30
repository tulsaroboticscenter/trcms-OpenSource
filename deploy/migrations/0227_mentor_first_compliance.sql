-- 0227 — Expand mentor FIRST compliance to the member profile: add Consent & Release and
-- Role-Specific Training (alongside the existing YPT, background check and FIRST-registered),
-- and move the per-team FIRST + Consent&Release flags up to the mentor's single compliance record.
ALTER TABLE adult_roles
  ADD COLUMN consent_release_complete TINYINT(1) NULL AFTER first_date,
  ADD COLUMN consent_release_date     DATE NULL AFTER consent_release_complete,
  ADD COLUMN role_specific_complete   TINYINT(1) NULL AFTER consent_release_date,
  ADD COLUMN role_specific_date       DATE NULL AFTER role_specific_complete;

-- Default validity (in years) for the two new season items — renew each season, like FIRST.
INSERT INTO system_config (category, `values`)
  SELECT 'consent_release_valid_years', '[1]' WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'consent_release_valid_years');
INSERT INTO system_config (category, `values`)
  SELECT 'role_specific_valid_years', '[1]' WHERE NOT EXISTS (SELECT 1 FROM system_config WHERE category = 'role_specific_valid_years');

-- Make sure every mentor already flagged on a team has an adult_roles record to carry the status.
INSERT INTO adult_roles (member_id, role)
  SELECT DISTINCT tma.member_id, 'Mentor'
  FROM team_member_assignments tma
  LEFT JOIN adult_roles ar ON ar.member_id = tma.member_id
  WHERE (tma.registered_on_first = 1 OR tma.first_consent_release = 1) AND ar.id IS NULL;

-- Carry the per-team "registered on FIRST" up to the member (if not already set there).
UPDATE adult_roles ar
  JOIN (SELECT DISTINCT member_id FROM team_member_assignments WHERE registered_on_first = 1) t
    ON t.member_id = ar.member_id
  SET ar.first_complete = 1, ar.first_date = COALESCE(ar.first_date, CURDATE())
  WHERE COALESCE(ar.first_complete, 0) = 0;

-- Carry the per-team "Consent & Release" up to the member.
UPDATE adult_roles ar
  JOIN (SELECT DISTINCT member_id FROM team_member_assignments WHERE first_consent_release = 1) t
    ON t.member_id = ar.member_id
  SET ar.consent_release_complete = 1, ar.consent_release_date = COALESCE(ar.consent_release_date, CURDATE())
  WHERE COALESCE(ar.consent_release_complete, 0) = 0;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0227_mentor_first_compliance', NOW());
