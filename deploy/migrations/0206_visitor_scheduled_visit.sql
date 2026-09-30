-- 0206 — Scheduled/expected visitors (#177). A visitor can be recorded ahead of time
-- with the date they're expected to visit, so staff have a "who's coming tonight" list
-- on a meeting night. Nullable; a normal (walk-in) visitor just leaves it blank.
ALTER TABLE visitors
  ADD COLUMN scheduled_visit_date DATE NULL AFTER next_follow_up_date;
