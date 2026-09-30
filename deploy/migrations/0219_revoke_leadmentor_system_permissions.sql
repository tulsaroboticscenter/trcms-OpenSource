-- 0219 — Security: a Lead Mentor was able to give themselves the Admin role. Two problems were
-- fixed: (1) AdminController::assignRole/removeRole now block granting or removing the top-level
-- Admin / System Administrator roles unless the actor is already an administrator (code change), and
-- (2) the "Mentor - Lead" role should not hold members.system_permissions (manage system-role
-- assignments) at all — that is an admin-only capability. This revokes it.
--
-- Re-grant it in Admin -> Role Management -> (Members group) "System Permissions" if that access was
-- intended, but note the code now prevents anyone but an administrator from assigning Admin/SysAdmin.

UPDATE role_permissions
   SET level = 'none'
 WHERE resource_key = 'members.system_permissions'
   AND role_id = (SELECT id FROM system_roles WHERE name = 'Mentor - Lead');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0219_revoke_leadmentor_system_permissions', NOW());
