-- Let the Admin team delete enrollments, not just System Administrators.
--
-- Deleting an enrollment used to be a hardcoded "System Administrator only" role-name
-- check in EnrollmentController::delete. It is now gated on a real permission key,
-- `enrollment.delete`, so access is configurable in Admin -> Role Management like
-- everything else.
--
-- The key defaults to 'none' (config/permissions.json RESOURCE_DEFAULTS) so it is NOT
-- world-writable. This seeds 'write' for Admin and System Administrator out of the box
-- (System Administrator is a super-role and already implicitly has every permission, but
-- it is seeded explicitly so the grant is visible and survives any change to super-role
-- handling). Keyed by role NAME, guarded by NOT EXISTS, safe to re-run.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'enrollment.delete', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'enrollment.delete');
