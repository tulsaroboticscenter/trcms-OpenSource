-- Make "seeing and running reports" governed by Role Permissions.
-- reports.view / reports.export now default to "none" (see config/permissions.json),
-- so the Reports area is grant-to-enable like the Admin keys. Previously it was
-- gated by a hard-coded role list on the nav item, which Role Management could not
-- override. Seed the roles that had access *today* so no one loses it on deploy:
--   - System Administrator: super, always allowed (no row needed).
--   - Admin + Mentor: granted read on view/export here.
-- Every member_type=mentor account holds the implicit "Mentor" role, so lead
-- mentors and regular mentors are covered by the single Mentor grant.
-- Admins can now widen/narrow this per role in Admin -> Role Permissions.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, k.resource_key, 'read'
FROM system_roles sr
CROSS JOIN (SELECT 'reports.view' AS resource_key UNION ALL SELECT 'reports.export') k
WHERE sr.name IN ('Admin', 'Mentor')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = sr.id AND rp.resource_key = k.resource_key
  );
