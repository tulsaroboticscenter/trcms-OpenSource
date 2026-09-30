-- 0216 — Dedicated permission to change a team page's photo, separate from editing the
-- rest of the team profile. Lets a team leader keep the team photo current without full
-- edit rights. Key defaults to "none" in config/permissions.json; seeded to Team Leader
-- here. Mentors/Admins/System Administrators are already allowed by role in the endpoint.
-- Grant it to any other role in Admin -> Role Management -> (Teams group) "Change Team Page Photo".

INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'teams.photo', 'write'
  FROM system_roles
 WHERE name IN ('Team Leader');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0216_teams_photo_permission', NOW());
