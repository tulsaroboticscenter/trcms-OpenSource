-- Private groups: their meeting minutes are limited to group members + admins, instead
-- of being readable by any signed-in member. Default 0 (public, unchanged behaviour);
-- the TRCF board is marked private so its minutes stay board-only.
ALTER TABLE member_groups ADD COLUMN is_private TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;
UPDATE member_groups SET is_private = 1 WHERE name = 'TRCF Board';
