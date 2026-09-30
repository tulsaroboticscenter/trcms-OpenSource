-- Tasks module (#112 assign to a team or a person; #114 recurring + team rotation).
-- A recurring task rolls forward in place on completion: its due date advances and,
-- if it rotates, the assigned team moves to the next team in the rotation.
CREATE TABLE IF NOT EXISTS tasks (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  title              VARCHAR(200) NOT NULL,
  description        TEXT NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'open',   -- open | in_progress | done
  priority           VARCHAR(10) NOT NULL DEFAULT 'normal', -- low | normal | high
  assignee_member_id INT NULL,                              -- an individual (members.id)
  assignee_team_id   INT NULL,                              -- OR a team (teams.id)
  due_date           DATE NULL,
  recurrence         VARCHAR(12) NOT NULL DEFAULT 'none',   -- none|daily|weekly|biweekly|monthly
  recurrence_interval INT NOT NULL DEFAULT 1,               -- every N periods
  rotates            TINYINT(1) NOT NULL DEFAULT 0,         -- rotate through rotation teams
  rotation_index     INT NOT NULL DEFAULT 0,
  created_by_id      INT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NULL,
  last_completed_at  DATETIME NULL,
  last_completed_by_id INT NULL,
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_member (assignee_member_id),
  INDEX idx_tasks_team (assignee_team_id),
  INDEX idx_tasks_due (due_date)
);

-- Ordered teams a rotating recurring task cycles through.
CREATE TABLE IF NOT EXISTS task_rotation_teams (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  task_id   INT NOT NULL,
  team_id   INT NOT NULL,
  position  INT NOT NULL DEFAULT 0,
  INDEX idx_task_rotation (task_id, position)
);

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0069_tasks', NOW());
