-- 0050_sponsors_module.sql — Sponsors Module (2.0, Phase 1 MVP)
-- Program vs. Team sponsors with team-scoped outreach; contributions posting to
-- team/program budgets; basic deliverables; outreach contact log. Seasons use the
-- existing FIRST-season string format (e.g. "2026-2027").

CREATE TABLE IF NOT EXISTS sponsors (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(250) NOT NULL,
  scope                 ENUM('program','team') NOT NULL DEFAULT 'team',
  tier                  VARCHAR(40) NULL,            -- manual override; else computed from contributions
  tier_locked          TINYINT(1) NOT NULL DEFAULT 0, -- when 1, `tier` is a manual override
  lifecycle_state       ENUM('prospective','active','lapsed','declined') NOT NULL DEFAULT 'prospective',
  relationship_owner_id INT NULL,
  primary_contact_name  VARCHAR(200) NULL,
  primary_contact_email VARCHAR(200) NULL,
  primary_contact_phone VARCHAR(50) NULL,
  website               VARCHAR(300) NULL,
  logo_url              VARCHAR(500) NULL,
  industry_category     VARCHAR(120) NULL,
  season                VARCHAR(10) NOT NULL,        -- FIRST season scope
  youth_safety_flag     TINYINT(1) NOT NULL DEFAULT 0,
  youth_safety_notes    TEXT NULL,
  source                VARCHAR(40) NULL,            -- referral/self/returning/research/event
  decline_reason        TEXT NULL,
  notes                 TEXT NULL,
  created_by_id         INT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sponsors_scope (scope),
  KEY idx_sponsors_state (lifecycle_state),
  KEY idx_sponsors_season (season),
  CONSTRAINT fk_sponsors_owner FOREIGN KEY (relationship_owner_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Owning teams for team-scoped sponsors (ownership persists across seasons → team, not team_season).
CREATE TABLE IF NOT EXISTS sponsor_teams (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  sponsor_id INT NOT NULL,
  team_id    INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sponsor_team (sponsor_id, team_id),
  CONSTRAINT fk_spt_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE,
  CONSTRAINT fk_spt_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sponsor_contributions (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  sponsor_id          INT NOT NULL,
  season              VARCHAR(10) NOT NULL,
  contribution_type   ENUM('monetary','in_kind') NOT NULL DEFAULT 'monetary',
  amount              DECIMAL(12,2) NULL,
  in_kind_description TEXT NULL,
  in_kind_value       DECIMAL(12,2) NULL,
  status              ENUM('pledged','received','declined','refunded') NOT NULL DEFAULT 'pledged',
  designation         VARCHAR(40) NOT NULL DEFAULT 'general',
  pledge_date         DATE NULL,
  received_date       DATE NULL,
  payment_reference   VARCHAR(120) NULL,
  credited_team_id    INT NULL,          -- team whose budget it posts to; NULL = program
  budget_donation_id  INT NULL,          -- link to inv_fundraising_donations line
  recorded_by_id      INT NULL,
  notes               TEXT NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contrib_sponsor (sponsor_id),
  KEY idx_contrib_season (season),
  CONSTRAINT fk_contrib_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sponsor_deliverables (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  sponsor_id       INT NOT NULL,
  season           VARCHAR(10) NOT NULL,
  description      TEXT NOT NULL,
  category         VARCHAR(60) NULL,
  due_date         DATE NULL,
  assigned_to_id   INT NULL,
  status           ENUM('pending','in_progress','complete','overdue','waived') NOT NULL DEFAULT 'pending',
  completion_date  DATE NULL,
  completion_notes TEXT NULL,
  created_by_id    INT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_deliv_sponsor (sponsor_id),
  CONSTRAINT fk_deliv_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Outreach contact log (who reached out, when, how) — enforces the team guardrail on write.
CREATE TABLE IF NOT EXISTS sponsor_contacts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  sponsor_id   INT NOT NULL,
  member_id    INT NULL,
  method       VARCHAR(30) NULL,   -- email/phone/in_person/event/other
  notes        TEXT NULL,
  outcome      VARCHAR(120) NULL,
  contacted_at DATE NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contact_sponsor (sponsor_id),
  CONSTRAINT fk_contact_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Let a fundraising budget line originate from a sponsor contribution (mirrors grant_id).
ALTER TABLE inv_fundraising_donations ADD COLUMN sponsor_id INT NULL AFTER grant_id;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0050_sponsors_module', NOW());
