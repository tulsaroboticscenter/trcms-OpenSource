-- 0204 — Raffles: gate the module on a configurable permission instead of a hardcoded
-- role-name check. New permission `raffles.manage` = "create/run raffles, record booth
-- sales, and draw winners." Seeded to the mentor family + Executive Director, matching
-- who could manage raffles before (Mentor). Admin / System Administrator are superusers
-- and pass automatically without a row here. The public ticket-buying pages need no
-- permission (they are unauthenticated). Adjust grants any time in Admin -> Role Management.
INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'raffles.manage', 'write'
  FROM system_roles
 WHERE name IN ('Mentor', 'Mentor - Lead', 'Mentor - Junior', 'Executive Director');
