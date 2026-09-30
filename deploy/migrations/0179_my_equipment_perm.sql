-- Make the "My Equipment" sidebar item controllable per role (it was ungated / visible to
-- everyone), and hide it from volunteers by default — a volunteer doesn't check out gear.
--
-- Seed inventory.my_equipment = read for every real role EXCEPT Volunteer (and Default /
-- kiosk-station roles), so nothing changes for anyone else. The Volunteer role gets no row,
-- so it falls to the 'none' default (permissions.json) and the menu is hidden. Grant it to
-- the Volunteer role in Role Management later if that ever changes.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'inventory.my_equipment', 'read'
  FROM system_roles sr
 WHERE sr.is_active = 1
   AND sr.name NOT IN ('Default', 'Volunteer')
   AND sr.name NOT LIKE '%Station%'
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'inventory.my_equipment');
