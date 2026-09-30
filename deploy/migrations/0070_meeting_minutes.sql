-- Meeting minutes (#107) — built for the YLC but usable by any group. Action
-- items can be assigned to a member and are tracked as Tasks (task_id link).
CREATE TABLE IF NOT EXISTS meetings (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  group_label   VARCHAR(60)  NOT NULL DEFAULT 'YLC',
  title         VARCHAR(200) NOT NULL,
  meeting_date  DATE NULL,
  location      VARCHAR(200) NULL,
  notes         MEDIUMTEXT NULL,
  created_by_id INT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NULL,
  INDEX idx_meetings_group (group_label, meeting_date)
);

CREATE TABLE IF NOT EXISTS meeting_attendees (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  meeting_id INT NOT NULL,
  member_id  INT NULL,
  name       VARCHAR(200) NULL,   -- for a guest not in the system
  INDEX idx_meeting_att (meeting_id)
);

CREATE TABLE IF NOT EXISTS meeting_action_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  meeting_id         INT NOT NULL,
  description        VARCHAR(500) NOT NULL,
  assignee_member_id INT NULL,
  due_date           DATE NULL,
  status             VARCHAR(20) NOT NULL DEFAULT 'open', -- open | done
  task_id            INT NULL,     -- the Task created for the assignee
  created_by_id      INT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action_meeting (meeting_id)
);

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0070_meeting_minutes', NOW());
