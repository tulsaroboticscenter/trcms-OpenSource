-- In-app feedback: bug reports and feature requests from any logged-in user,
-- plus admin triage and deployment tracking (which release / date a fix shipped).
CREATE TABLE feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  member_id INT NULL,
  type ENUM('bug','feature','other') NOT NULL DEFAULT 'bug',
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  steps TEXT NULL,
  page VARCHAR(300) NULL,
  app_version VARCHAR(40) NULL,
  user_agent VARCHAR(400) NULL,
  status ENUM('new','planned','in_progress','done','declined') NOT NULL DEFAULT 'new',
  priority ENUM('low','normal','high','critical') NOT NULL DEFAULT 'normal',
  admin_notes TEXT NULL,
  resolution_release VARCHAR(40) NULL,
  deployed_on DATE NULL,
  resolution_notes TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_feedback_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL,
  INDEX idx_feedback_status (status, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
