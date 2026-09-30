-- Make the "Season Goals" nav item permission-gated instead of visible to everyone.
--
-- goals.view used to default to 'read' for all (permissions.json), so the menu tab showed
-- for every user. Its default is now 'none'; this seeds 'read' for the roles that should
-- see it out of the box (leadership + mentors + team leaders). Admins can grant/remove it
-- for any role in Admin -> Role Management. Keyed by role NAME, safe to re-run.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'goals.view', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Executive Director',
                   'Mentor', 'Mentor - Lead', 'Mentor - Junior', 'Team Leader')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'goals.view');
