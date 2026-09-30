-- Outside volunteers on an event's attendee list are visible only to Admins and Lead
-- Mentors. Seed events.view_volunteers = read for those roles (default 'none' in
-- permissions.json). Everyone else sees the roster without volunteers; volunteers
-- themselves see no roster at all (enforced in code by member_type). Idempotent, by role name.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'events.view_volunteers', 'read'
  FROM system_roles sr
 WHERE sr.is_active = 1
   AND sr.name IN ('Admin', 'System Administrator', 'Mentor - Lead')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'events.view_volunteers');
