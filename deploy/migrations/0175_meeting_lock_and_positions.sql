-- Lockable meeting minutes + board positions.
--
-- A meeting can be LOCKED after the board reviews and approves it — freezing the agenda,
-- minutes, attendees and action items. Locking is done by an officer (President / Vice
-- President / Secretary) or a System Administrator.
--
-- To know who the officers are, group membership gains a position (role_label): the TRCF
-- board's members can be tagged President/Vice President/Secretary/Treasurer/Member.
ALTER TABLE meetings
  ADD COLUMN locked_at    DATETIME NULL,
  ADD COLUMN locked_by_id INT      NULL;

ALTER TABLE member_group_members
  ADD COLUMN role_label VARCHAR(50) NULL AFTER member_id;
