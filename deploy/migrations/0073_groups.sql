-- Reusable member groups (YLC, committees, crews…). A group has members and can
-- be tied to events; a group's upcoming events surface to its members' dashboards.
CREATE TABLE IF NOT EXISTS member_groups (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  description  VARCHAR(400) NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_by_id INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NULL,
  UNIQUE KEY uq_member_group_name (name)
);

CREATE TABLE IF NOT EXISTS member_group_members (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  group_id  INT NOT NULL,
  member_id INT NOT NULL,
  added_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_group_member (group_id, member_id),
  INDEX idx_gm_member (member_id)
);

CREATE TABLE IF NOT EXISTS event_groups (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  group_id INT NOT NULL,
  UNIQUE KEY uq_event_group (event_id, group_id),
  INDEX idx_eg_group (group_id)
);

-- Seed the YLC group.
INSERT IGNORE INTO member_groups (name, description, is_active, created_at)
  VALUES ('YLC', 'Youth Leadership Council', 1, NOW());

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0073_groups', NOW());
