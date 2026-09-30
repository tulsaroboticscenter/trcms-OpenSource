-- A locked-down "Default" role automatically assigned to members until an admin
-- sets an explicit role. Previously a member with no assigned role silently
-- inherited their member_type's role (Youth Member / Mentor / …) plus a
-- permissive write fallback — so imported members had broad, unclear access.
-- "Default" makes that state explicit and restricted (edit its permissions in
-- Role Management to control what unassigned members can see; it starts empty).
INSERT INTO system_roles (name, display_name, description, is_active)
VALUES ('Default', 'Default (Unassigned)',
        'Automatically assigned to members until an explicit role is set. Starts with no permissions — edit to control what unassigned members can see.', 1)
ON DUPLICATE KEY UPDATE is_active = 1;

-- Default's only permission: VIEW your own profile (read). No write, nothing else.
-- Edit this in Role Management to widen what unassigned members can see.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT (SELECT id FROM system_roles WHERE name = 'Default'), 'members.edit_own', 'read'
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions
  WHERE role_id = (SELECT id FROM system_roles WHERE name = 'Default') AND resource_key = 'members.edit_own'
);

-- Backfill: every real (non-system, non-kiosk) member who has no explicit system
-- role gets Default, so nobody is left in the old silent-inherit state.
INSERT INTO member_system_roles (member_id, role_id)
SELECT m.id, (SELECT id FROM system_roles WHERE name = 'Default')
FROM members m
WHERE (m.is_system = 0 OR m.is_system IS NULL)
  AND (m.is_kiosk = 0 OR m.is_kiosk IS NULL)
  AND NOT EXISTS (SELECT 1 FROM member_system_roles msr WHERE msr.member_id = m.id);
