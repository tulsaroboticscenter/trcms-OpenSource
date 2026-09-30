-- SECURITY FIX: members.view_address and members.view_medical had no entry in
-- RESOURCE_DEFAULTS, so they fell through to DEFAULT_LEVEL = 'write'. Any member with
-- a real role (e.g. Youth Member) therefore passed the permission check and could see
-- another member's home address and medical/emergency information from their profile.
-- Reported when a youth visiting a mentor's profile could read her address.
--
-- config/permissions.json now defaults both to 'none'. That alone denies everyone, so
-- this migration grants read back to the same staff roles that already hold
-- members.view_contact. Keyed by role NAME; safe to re-run.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, k.resource_key, 'read'
  FROM system_roles sr
  CROSS JOIN (SELECT 'members.view_address' AS resource_key
              UNION ALL SELECT 'members.view_medical') k
 WHERE sr.name IN ('System Administrator', 'Admin', 'Mentor')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = k.resource_key);
