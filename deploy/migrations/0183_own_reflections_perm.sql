-- Make the "My Reflections" pane controllable per role. It used to show for every member
-- on their own profile via a hardcoded self-check; now it's gated on members.own_reflections
-- (default 'none' in permissions.json). Seed READ for every real role EXCEPT Default and
-- kiosk-station roles, so nothing changes for anyone today — an admin turns it OFF for a
-- role by setting "Use the My Reflections pane" to None in Role Management.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'members.own_reflections', 'read'
  FROM system_roles sr
 WHERE sr.is_active = 1
   AND sr.name <> 'Default'
   AND sr.name NOT LIKE '%Station%'
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'members.own_reflections');
