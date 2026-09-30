-- 0197 — Program Team group (a members-run meeting group that EVERYONE can view).
-- New `public_view` flag: when set, a group's minutes are readable by every signed-in
-- member regardless of is_private, while management stays gated by is_private. So the
-- Program Team is is_private=1 (agenda/notes/attendees editable only by its members +
-- admins, exactly like the TRCF Board) yet public_view=1 (visible to all).
ALTER TABLE member_groups
  ADD COLUMN public_view TINYINT(1) NOT NULL DEFAULT 0 AFTER is_private;

INSERT IGNORE INTO member_groups (name, description, is_active, is_private, public_view, source, created_at)
VALUES ('Program Team', 'TRC Program Team', 1, 1, 1, 'manual', NOW());
