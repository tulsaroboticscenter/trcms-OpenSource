-- Volunteer role management + per-role control of the "My Time" / "My Resume" menus.
--
-- Two related changes the user asked for:
--
-- 1. The "My Time" and "My Resume" sidebar items had NO permission behind them
--    (visible to everyone, ungated), so they couldn't be turned off per role. They are
--    now gated on new keys activity.my_time / resume.view. Seed READ on every real role
--    so nothing changes for anyone today; an admin turns a menu OFF for a role by setting
--    that key to "None" in Role Management. Default is deliberately NOT seeded — a member
--    who carries the Default role would otherwise always keep the menu (Default acts as a
--    floor), which is exactly what made this impossible before.
--
-- 2. Volunteers who sign up should hold ONLY the Volunteer role, not Default. The Default
--    role grants nothing (every key is "none"); it only prevented per-role control. Drop
--    it from existing volunteers who already have the Volunteer role so the Volunteer role
--    is the single lever for what a volunteer can see. (New sign-ups skip Default in code.)

-- 1. Seed read for the two nav keys on all active, non-Default, non-kiosk roles.
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, k.resource_key, 'read'
  FROM system_roles sr
  CROSS JOIN (SELECT 'activity.my_time' AS resource_key
              UNION ALL SELECT 'resume.view') k
 WHERE sr.is_active = 1
   AND sr.name <> 'Default'
   AND sr.name NOT LIKE '%Station%'
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = k.resource_key);

-- 2. Remove the Default role from existing volunteers who also hold the Volunteer role
--    (so they are never left role-less — their member_type keeps the implicit Volunteer
--    role). A second join to member_system_roles (v) proves they have the Volunteer role;
--    this is a multi-table DELETE (no subquery on the target table), which avoids MySQL
--    error #1093. Idempotent — re-running deletes nothing once they're off Default.
DELETE msr
  FROM member_system_roles msr
  JOIN system_roles def ON def.id = msr.role_id AND def.name = 'Default'
  JOIN members m         ON m.id = msr.member_id AND m.member_type = 'volunteer'
  JOIN member_system_roles v ON v.member_id = msr.member_id
  JOIN system_roles vr       ON vr.id = v.role_id AND vr.name = 'Volunteer';
