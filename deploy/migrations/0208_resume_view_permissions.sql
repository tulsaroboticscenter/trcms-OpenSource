-- 0208 — Resume visibility permissions. Two new role-configurable keys (Admin ->
-- Role Management -> Resume), defaulting to "none" in config/permissions.json:
--   resume.view_others   — view any youth's resume (staff)
--   resume.mark_complete — mark another member's resume complete / reopen it
-- Contextual access (self, a youth's guardian, a member of the team interviewing the
-- youth, and a team youth viewing an FDP-eligible candidate) is enforced in code by
-- relationship, not by these role keys. Seeded to sensible roles; adjust any time in
-- Role Management. System Administrator passes automatically as a superuser.

INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'resume.view_others', 'read'
  FROM system_roles
 WHERE name IN ('System Administrator', 'Admin', 'Mentor', 'Mentor - Lead');

INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'resume.mark_complete', 'write'
  FROM system_roles
 WHERE name IN ('System Administrator', 'Admin', 'Mentor - Lead');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0208_resume_view_permissions', NOW());
