-- 0077 — Allow a whole team (not just an individual) to be recorded as having
-- completed a TRC/Team task. When a task is finished by a team, we store the
-- team-season here instead of completed_by_member_id.

ALTER TABLE team_tasks
  ADD COLUMN completed_by_team_season_id INT NULL AFTER completed_by_member_id;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0077', NOW());
