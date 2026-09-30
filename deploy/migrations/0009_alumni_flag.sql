-- Alumni is a permanent attribute that rides alongside a member's current
-- member_type (a graduated youth who returns as a mentor stays an alum). It is
-- therefore a flag on the member, NOT one of the mutually-exclusive member_type
-- values. Set once (e.g. when graduating into the Hall of Fame) and persists.
ALTER TABLE members
  ADD COLUMN is_alumni TINYINT(1) NOT NULL DEFAULT 0;
