-- 0130_members_view_contact_perm.sql
-- Member email/phone visibility is now the role permission members.view_contact
-- (Admin -> Role Management), replacing a hardcoded Admin/System Administrator/
-- Mentor role-name check. The permission defaults to 'none' (private), so seed the
-- staff roles that previously saw contact info with 'read' to preserve behavior.
-- You always see your own, a youth's parent sees theirs, and member editors keep
-- access (members.edit_others) regardless. Grant any other role in Role Management.
--
-- Keyed by role NAME (env-safe); only inserts where a row doesn't already exist.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'members.view_contact', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('Admin', 'System Administrator', 'Mentor')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'members.view_contact');
