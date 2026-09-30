-- 0129_youth_team_task_view_perms.sql
-- Make the "youth only see their own teams / tasks" restriction role-configurable
-- (Admin -> Role Management) instead of hardcoded to member_type.
--
-- The teams.profiles_others / teams.roster_others permissions already exist and
-- default to 'read' (everyone sees all). planning.tasks_others is new (added to the
-- catalog, also defaulting to 'read'). Seed the Youth Member role with an explicit
-- 'none' on all three so youth see only their own teams and their own team's tasks
-- (plus TRC tasks) — while an admin can grant any role these in Role Management.
--
-- Keyed by role NAME (env-safe) and only inserts a row where one doesn't already
-- exist, so it's safe to re-run.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, x.k, 'none'
  FROM system_roles sr
  JOIN (SELECT 'teams.profiles_others' AS k
        UNION ALL SELECT 'teams.roster_others'
        UNION ALL SELECT 'planning.tasks_others') x
 WHERE sr.name = 'Youth Member'
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = x.k);
