-- FDP: schedule a board of review ahead of time.
--
-- fdp_progress already records a board review AFTER it happens (board_review_date +
-- outcome + panel + notes). This adds the ability to book one in advance: a future
-- date/time and a location, separate from the held date. The panel is the existing
-- board_review_panel column, filled at scheduling time.
--
-- Lifecycle on one youth's row:
--   scheduled  -> board_review_scheduled_at + panel + location set, outcome still NULL
--   held       -> board_review_date + outcome recorded (the milestone), as before
-- A youth has at most one pending review, so this lives on the single fdp_progress
-- row rather than a separate table.
ALTER TABLE fdp_progress
  ADD COLUMN board_review_scheduled_at DATETIME     NULL AFTER board_review_by_id,
  ADD COLUMN board_review_location     VARCHAR(200) NULL AFTER board_review_scheduled_at;
