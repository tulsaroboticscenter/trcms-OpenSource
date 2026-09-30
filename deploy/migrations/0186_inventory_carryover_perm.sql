-- Dedicated permission for setting a team's Prior-Year Carryover. Previously the
-- carryover setter shared inventory.budgets (write), which Mentors, Mentor - Lead and
-- Team Leaders hold for normal budget/BOM work — so they could change carryover too.
-- Carryover is a sensitive prior-year money figure that should be admin-only, so it now
-- has its own key (default 'none' in permissions.json). Seed WRITE for Admin and System
-- Administrator only; every other role stays 'none'. By role NAME + NOT EXISTS guard so
-- it's env-safe and re-runnable (role_permissions has no unique key on role/resource).

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'inventory.carryover', 'write'
  FROM system_roles sr
 WHERE sr.is_active = 1
   AND sr.name IN ('Admin', 'System Administrator')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'inventory.carryover');
