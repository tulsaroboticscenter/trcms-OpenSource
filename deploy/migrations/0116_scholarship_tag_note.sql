-- Mentors can "tag" a youth onto a scholarship: it lands on the youth's Watchlist
-- (a college_scholarship_follows row) with an optional personal note explaining
-- why. created_by_id already records who tagged them; add the note text.
ALTER TABLE college_scholarship_follows
  ADD COLUMN suggested_note VARCHAR(1000) NULL AFTER created_by_id;
