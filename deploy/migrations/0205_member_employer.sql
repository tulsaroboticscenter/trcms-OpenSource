-- 0205 — Employer & matching-gift info for adults (parents / mentors / volunteers).
-- Captures who an adult works for and whether that employer offers corporate philanthropy
-- TRC can tap: donation (gift) matching, volunteer grants ("Dollars for Doers" — cash the
-- company gives based on the employee's volunteer hours), or grants a nonprofit can apply
-- for. All optional; youth never see these fields. Viewing is gated on members.view_employer.
ALTER TABLE members
  ADD COLUMN employer_name          VARCHAR(200) NULL AFTER robotics_experience_years,
  ADD COLUMN employer_job_title     VARCHAR(150) NULL AFTER employer_name,
  ADD COLUMN employer_matches_donations VARCHAR(10) NULL AFTER employer_job_title, -- yes | no | unsure
  ADD COLUMN employer_volunteer_grants  VARCHAR(10) NULL AFTER employer_matches_donations, -- yes | no | unsure
  ADD COLUMN employer_offers_grants     VARCHAR(10) NULL AFTER employer_volunteer_grants,   -- yes | no | unsure
  ADD COLUMN employer_program_info  TEXT NULL AFTER employer_offers_grants,       -- portal link / program details
  ADD COLUMN employer_matching_help TINYINT(1) NOT NULL DEFAULT 0 AFTER employer_program_info, -- willing to help set it up
  ADD COLUMN employer_notes         TEXT NULL AFTER employer_matching_help;

-- View permission (default "none" is set in config/permissions.json RESOURCE_DEFAULTS).
-- Seeded to the fundraising/admin roles; Admin / System Administrator are superusers and
-- pass automatically. Broaden in Admin -> Role Management as needed.
INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'members.view_employer', 'read'
  FROM system_roles
 WHERE name IN ('Executive Director', 'Scholarship Manager');
