-- "My Volunteering" page — opportunities + a printable per-event hours report.
--
-- Gated on volunteering.view (default 'none' in permissions.json). Seed READ for the roles
-- whose members should get the page: Volunteer, Mentor, Parent. Add another role later —
-- e.g. Sponsor — by granting it in Role Management (no code change needed).

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'volunteering.view', 'read'
  FROM system_roles sr
 WHERE sr.is_active = 1
   AND sr.name IN ('Volunteer', 'Mentor', 'Parent')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'volunteering.view');
