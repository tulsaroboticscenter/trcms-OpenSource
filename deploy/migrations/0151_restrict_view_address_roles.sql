-- SECURITY (completes the 0149 fix).
--
-- 0149 set members.view_address to default 'none' and granted read to staff roles.
-- That closed the hole on a database with no explicit rows for the key, but PRODUCTION
-- has explicit role_permissions rows granting members.view_address to Youth Member,
-- Parent, Volunteer, Mentor - Junior, Event Check-In Station and others. 0149's inserts
-- were guarded by NOT EXISTS, so they left those rows untouched and the leak stayed
-- live: reproduced on a copy of prod data, where a Youth Member account read a mentor's
-- full home address off their profile.
--
-- Home addresses are now readable only by the adult staff roles that need to contact
-- families. Everyone still sees their own address, and a parent still sees their own
-- youth's — MembersController grants both directly, without this key.
--
-- Set to 'none' rather than deleting so the restriction is visible in
-- Admin -> Role Management instead of silently falling back to the default.
UPDATE role_permissions rp
   JOIN system_roles sr ON sr.id = rp.role_id
    SET rp.level = 'none'
  WHERE rp.resource_key = 'members.view_address'
    AND rp.level <> 'none'
    AND sr.name NOT IN ('System Administrator', 'Admin', 'Mentor', 'Mentor - Lead');
