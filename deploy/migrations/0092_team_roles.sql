-- 0092 — Team Member Roles (Release 3.5, #127). Team-leader-defined roles unique to
-- each team/season (Design Lead, Build Team, Programmer…), separate from the admin
-- system roles. A member can hold several roles, and a Season Plan activity can be
-- assigned to a role so that role's team owns it.

CREATE TABLE IF NOT EXISTS team_roles (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id INT NOT NULL,
  name           VARCHAR(120) NOT NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  created_by_id  INT NULL,
  created_at     DATETIME NULL,
  KEY idx_tr_team (team_season_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS team_role_members (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  team_role_id INT NOT NULL,
  member_id    INT NOT NULL,
  UNIQUE KEY uq_trm (team_role_id, member_id),
  CONSTRAINT fk_trm_role FOREIGN KEY (team_role_id) REFERENCES team_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_trm_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE season_activities
  ADD COLUMN assigned_role_id INT NULL AFTER lead_member_id,
  ADD CONSTRAINT fk_sa_role FOREIGN KEY (assigned_role_id) REFERENCES team_roles(id) ON DELETE SET NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0092', NOW());
