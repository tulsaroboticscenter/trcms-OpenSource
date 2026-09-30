-- Progress tracking for complex tasks: a percent-complete on the task plus a
-- timestamped thread of progress updates that anyone working the task can post.
ALTER TABLE team_tasks
  ADD COLUMN progress_pct TINYINT UNSIGNED NULL AFTER status;

CREATE TABLE IF NOT EXISTS team_task_updates (
  id INT NOT NULL AUTO_INCREMENT,
  task_id INT NOT NULL,
  member_id INT NULL,
  body TEXT NULL,
  progress_pct TINYINT UNSIGNED NULL,   -- the % this update set it to (if any)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ttu_task (task_id),
  CONSTRAINT fk_ttu_task FOREIGN KEY (task_id) REFERENCES team_tasks (id) ON DELETE CASCADE,
  CONSTRAINT fk_ttu_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
