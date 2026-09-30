-- 0131_revoke_youth_resource_grant.sql
-- Youth must not be able to grant or manage resource access. The youth-facing
-- "Team Leader" role was granting resources.manage (create/edit resources + their
-- access), and on some environments resources.grant (approve access requests).
-- Remove both resource-control permissions from the youth-facing roles so only
-- adult/staff roles can do it. Grant these back to any specific role in
-- Admin -> Role Management if a role legitimately needs them.
--
-- Keyed by role NAME (env-safe). Deleting a row makes the role fall back to the
-- catalog default ('none') for that key.

DELETE rp FROM role_permissions rp
  JOIN system_roles sr ON sr.id = rp.role_id
 WHERE sr.name IN ('Team Leader', 'Youth Member')
   AND rp.resource_key IN ('resources.grant', 'resources.manage');
