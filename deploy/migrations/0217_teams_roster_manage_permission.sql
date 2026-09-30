-- 0217 — Grantable permission to manage a team's roster (add / remove members), separate from
-- the view-only teams.roster_own / teams.roster_others. Adding/removing team members used to be
-- hardcoded to Admin / System Administrator, so there was no role to grant. Seeded to Mentor - Lead
-- here (and to Admin / System Administrator for visibility; they also pass as superusers). Grant it
-- to any other role in Admin -> Role Management -> (Teams group) "Manage Team Roster".
-- Key defaults to "none" in config/permissions.json. Hard-delete (purge) stays System Administrator-only.

INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'teams.roster_manage', 'write'
  FROM system_roles
 WHERE name IN ('Mentor - Lead', 'Admin', 'System Administrator');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0217_teams_roster_manage_permission', NOW());
