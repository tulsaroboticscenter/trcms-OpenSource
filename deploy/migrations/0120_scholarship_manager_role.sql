-- A ready-to-assign "Scholarship Manager" role so a parent (or anyone) can run the
-- College Scholarships catalog without being a full Mentor/Admin. It carries the
-- new scholarships.manage permission. Assign it to a member in Role Management;
-- adjust its permissions there anytime.

INSERT INTO system_roles (name, display_name, description, is_active)
VALUES ('Scholarship Manager', 'Scholarship Manager',
        'Manages the College Scholarships catalog: add/edit scholarships, tag youth, run reports, roll the season forward.', 1)
ON DUPLICATE KEY UPDATE is_active = 1;

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT (SELECT id FROM system_roles WHERE name = 'Scholarship Manager'), 'scholarships.manage', 'write'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions
  WHERE role_id = (SELECT id FROM system_roles WHERE name = 'Scholarship Manager')
    AND resource_key = 'scholarships.manage'
);
