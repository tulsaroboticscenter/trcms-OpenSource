-- "My Reflections" — a private, youth-owned pane on their own profile where they
-- answer purpose/impact/growth questions for the season.
--
-- PRIVACY: this is the youth's own words and is NOT shared. It is visible only to
-- the member themselves and to roles holding members.view_reflections — seeded to
-- Admin / System Administrator ONLY (deliberately NOT mentors and NOT parents).
-- Only the member may write their own answers.
CREATE TABLE IF NOT EXISTS member_reflections (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  member_id       INT NOT NULL,
  enrollment_year INT NOT NULL,
  question_key    VARCHAR(60) NOT NULL,
  answer          TEXT NULL,
  updated_by_id   INT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_member_year_q (member_id, enrollment_year, question_key),
  KEY idx_member (member_id)
);

-- Viewing someone else's reflections is gated by members.view_reflections
-- (defaults to 'none' in config/permissions.json). Seed Admin + System Administrator
-- only. Keyed by role NAME; safe to re-run.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'members.view_reflections', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('Admin', 'System Administrator')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'members.view_reflections');
