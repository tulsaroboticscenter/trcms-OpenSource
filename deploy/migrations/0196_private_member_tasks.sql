-- 0196 — Private, per-member tasks on the task board.
-- A task with is_private=1 is directed at one member (assigned_member_id) and is
-- hidden from the shared TRC (General) and team boards. The assignee sees it in a
-- "My Tasks" pane on their Dashboard; managers can view/track all private tasks.
ALTER TABLE team_tasks
  ADD COLUMN is_private TINYINT(1) NOT NULL DEFAULT 0 AFTER assigned_team_season_id,
  ADD COLUMN assigned_member_id INT NULL AFTER is_private,
  ADD KEY idx_team_tasks_private (is_private, assigned_member_id);
