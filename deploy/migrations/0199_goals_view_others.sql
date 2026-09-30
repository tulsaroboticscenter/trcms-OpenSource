-- 0199 — Season Goals: scope viewing/managing to a member's own teams.
-- New permission goals.view_others = "see and manage goals for ALL teams, not just
-- your own". Granted to the adult staff roles that oversee every team; youth roles
-- (Youth Member, Team Leader) are intentionally NOT granted it, so they only see the
-- goals of teams they're rostered on. Admin / System Administrator are superusers and
-- pass automatically without a row here.
INSERT IGNORE INTO role_permissions (role_id, resource_key, level)
SELECT id, 'goals.view_others', 'read'
  FROM system_roles
 WHERE name IN ('Mentor', 'Mentor - Lead', 'Mentor - Junior', 'Executive Director');
