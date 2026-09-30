-- 0198 — Per-group position/title options.
-- Each group can carry its own list of member positions (a JSON array of strings).
-- NULL means "use the built-in default" (President / Vice President / Secretary /
-- Treasurer / Member). The Program Team uses a different set of titles than the
-- TRCF Board, so its options are seeded here and are editable in the group screen.
ALTER TABLE member_groups
  ADD COLUMN position_options TEXT NULL AFTER public_view;

UPDATE member_groups
   SET position_options = '["Executive Director","Program Director","Admin Lead","Mentor","Treasurer"]'
 WHERE name = 'Program Team';
