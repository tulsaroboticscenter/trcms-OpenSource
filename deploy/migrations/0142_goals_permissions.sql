-- Season Strategy — Goals RBAC seed.
-- goals.view defaults to 'read' for everyone (config/permissions.json defaults), so
-- no seed is needed for viewing. goals.manage defaults to 'none'; grant 'write' to
-- the roles that create/own/manage goals: System Administrator, Admin, Mentor,
-- Team Leader, and Youth Member (youth own their own goals; leads define the team's).
-- Configure any other role in Admin → Role Management. Keyed by role NAME (env-safe),
-- inserts only where a row doesn't already exist — safe to re-run.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'goals.manage', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Mentor', 'Team Leader', 'Youth Member')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'goals.manage');
