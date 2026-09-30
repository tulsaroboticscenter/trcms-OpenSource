-- 0211 — Dedicated permission to DELETE a scholarship application (e.g. remove a
-- duplicate), separate from the review/manage permission (scholarships.applications).
-- Key defaults to "none" in config/permissions.json; seeded to admins only. Adjust in
-- Admin -> Role Management -> (Members group) "Scholarship Applications — delete".
-- System Administrator passes automatically as a superuser; the explicit row is harmless.

INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'scholarships.applications.delete', 'write'
  FROM system_roles
 WHERE name IN ('System Administrator', 'Admin');

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0211_scholarship_delete_permission', NOW());
