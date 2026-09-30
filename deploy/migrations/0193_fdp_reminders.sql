-- 0193 — FDP reminder tracking. A "last reminded" date on interviews and on the board-review
-- appointment so the reminder cron can nudge families about an upcoming interview / board review
-- without emailing them again every day.

ALTER TABLE fdp_interviews
  ADD COLUMN reminded_at DATE NULL AFTER outcome;

ALTER TABLE fdp_progress
  ADD COLUMN board_review_reminded_at DATE NULL AFTER board_review_scheduled_at;
