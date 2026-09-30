-- 0075 — TRC/Team Tasks: team assignment (#112) + recurring/rotating chores (#114)
--
-- #112 Task Assignment: a task (typically a TRC-general task) can be picked up
--      by a whole TEAM, not just an individual. assigned_team_season_id names
--      that team; the task then appears in that team's task list.
--
-- #114 Recurring Tasks: a chore can recur on a frequency and rotate the
--      responsible team on a schedule (the Quartermaster's rotation). recurrence
--      holds the frequency, due_date the current occurrence's due date, and
--      team_task_rotation the ordered list of teams the chore rotates through
--      (rotation_index points at the current team). Completing a recurring task
--      rolls it forward: advance the due date, hand off to the next team, reopen.

ALTER TABLE team_tasks
  ADD COLUMN assigned_team_season_id INT NULL AFTER team_season_id,
  ADD COLUMN recurrence VARCHAR(20) NOT NULL DEFAULT 'none',
  ADD COLUMN due_date DATE NULL,
  ADD COLUMN rotation_index INT NOT NULL DEFAULT 0;

CREATE INDEX idx_team_tasks_assigned ON team_tasks (assigned_team_season_id);

CREATE TABLE IF NOT EXISTS team_task_rotation (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  team_season_id INT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  INDEX idx_ttr_task (task_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0075', NOW());
