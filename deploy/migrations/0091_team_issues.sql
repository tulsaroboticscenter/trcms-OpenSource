-- 0091 — Team Issue Log (Release 3.5, #126). A team-scoped log of problems the team
-- hits while working, with a discussion thread, tagged stakeholders, and an optional
-- link to a Season Plan activity. Shown as an "Issues" tab on the team page.

CREATE TABLE IF NOT EXISTS team_issues (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id     INT NOT NULL,
  title              VARCHAR(250) NOT NULL,
  description        TEXT NULL,
  reporter_id        INT NULL,
  status             ENUM('open','in_progress','on_hold','closed') NOT NULL DEFAULT 'open',
  resolution_notes   TEXT NULL,
  linked_activity_id INT NULL,           -- optional Season Plan activity this issue relates to
  created_by_id      INT NULL,
  updated_by_id      INT NULL,
  created_at         DATETIME NULL,
  updated_at         DATETIME NULL,
  closed_at          DATETIME NULL,
  KEY idx_ti_team (team_season_id),
  KEY idx_ti_status (status),
  CONSTRAINT fk_ti_activity FOREIGN KEY (linked_activity_id) REFERENCES season_activities(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS team_issue_stakeholders (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  issue_id  INT NOT NULL,
  member_id INT NOT NULL,
  UNIQUE KEY uq_tis (issue_id, member_id),
  CONSTRAINT fk_tis_issue FOREIGN KEY (issue_id) REFERENCES team_issues(id) ON DELETE CASCADE,
  CONSTRAINT fk_tis_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS team_issue_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  issue_id   INT NOT NULL,
  author_id  INT NULL,
  body       TEXT NOT NULL,
  created_at DATETIME NULL,
  KEY idx_tic_issue (issue_id),
  CONSTRAINT fk_tic_issue FOREIGN KEY (issue_id) REFERENCES team_issues(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0091', NOW());
