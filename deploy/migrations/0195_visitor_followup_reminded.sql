-- 0195 — Visitor follow-up reminder tracking. A "last reminded" date so the reminder cron can
-- nudge the assigned owner about a due/overdue prospect follow-up without emailing every day.

ALTER TABLE visitors
  ADD COLUMN follow_up_reminded_at DATE NULL AFTER next_follow_up_date;
