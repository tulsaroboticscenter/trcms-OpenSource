-- Season Strategy — Portfolio RBAC seed.
-- portfolio.view defaults 'read' for everyone (permissions.json). Grant write for the
-- roles that contribute/manage. contribute = add captures / update pieces you own;
-- manage = define the piece list, templates, portfolio status. Keyed by role NAME,
-- inserts only where absent — safe to re-run.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'portfolio.contribute', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Mentor', 'Team Leader', 'Youth Member')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'portfolio.contribute');

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'portfolio.manage', 'write'
  FROM system_roles sr
 WHERE sr.name IN ('System Administrator', 'Admin', 'Mentor', 'Team Leader')
   AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = sr.id AND rp.resource_key = 'portfolio.manage');
