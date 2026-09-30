-- Volunteers should be able to enter their own time but NOT search the member directory.
-- The "Members" nav item + the /members page are now gated on members.directory; revoke it
-- from the Volunteer role so volunteers lose the directory (their My Time page has no member
-- search, so time entry is unaffected). Idempotent.

UPDATE role_permissions rp
  JOIN system_roles sr ON sr.id = rp.role_id
   SET rp.level = 'none'
 WHERE sr.name = 'Volunteer'
   AND rp.resource_key = 'members.directory';

-- If the Volunteer role had no explicit row, add a 'none' one so it can't fall through to
-- the permissive default (members.directory defaults to 'write').
INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'members.directory', 'none'
  FROM system_roles sr
 WHERE sr.name = 'Volunteer'
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'members.directory');
