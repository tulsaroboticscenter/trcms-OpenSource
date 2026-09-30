-- Season Strategy — Portfolio piece tracker (Phase 2).
-- Tracks each portfolio PIECE (owner/status/due) all season; the finished asset is a
-- Canva link/file stored in the team's Resources section (portfolio_pieces.resource_id).
-- Captures are the all-season raw documentation that feeds the pieces.

CREATE TABLE IF NOT EXISTS team_portfolios (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id INT NOT NULL,
  season         VARCHAR(10) NULL,
  program        ENUM('FTC','FRC','FLL') NOT NULL DEFAULT 'FTC',
  award_target   ENUM('inspire','impact','other') NOT NULL DEFAULT 'inspire',
  builder_tool   VARCHAR(60) NOT NULL DEFAULT 'Canva',
  status         ENUM('planning','drafting','review','submission_ready') NOT NULL DEFAULT 'planning',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team (team_season_id)
);

CREATE TABLE IF NOT EXISTS portfolio_pieces (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id    INT NOT NULL,
  section_type    ENUM('team_background','sustainability','engineering_process','robot_design','outreach_impact','awards_narrative','custom') NOT NULL DEFAULT 'custom',
  title           VARCHAR(255) NOT NULL,
  description     TEXT NULL,
  owner_member_id INT NULL,
  status          ENUM('not_started','in_progress','review','done') NOT NULL DEFAULT 'not_started',
  due_date        DATE NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  resource_id     INT NULL,             -- → resources row (Canva link / file), scope 'team'
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_portfolio (portfolio_id)
);

CREATE TABLE IF NOT EXISTS portfolio_captures (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  portfolio_id INT NOT NULL,
  piece_id     INT NULL,               -- unfiled "inbox" if null
  member_id    INT NULL,
  capture_type ENUM('design_decision','test_result','outreach_event','photo','reflection','metric','quote') NOT NULL DEFAULT 'reflection',
  title        VARCHAR(255) NULL,
  body         TEXT NULL,
  occurred_on  DATE NULL,
  evidence_id  INT NULL,               -- strategy_evidence (Phase 3)
  file_id      INT NULL,
  tags         JSON NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_portfolio (portfolio_id),
  KEY idx_piece (piece_id)
);

-- Seed the shared "Portfolio Asset" resource_type (Q-A: seed one, teams may override).
INSERT INTO resource_types (name, icon, attributes, sort_order, is_active, created_at)
SELECT 'Portfolio Asset', 'FileText',
       JSON_ARRAY(
         JSON_OBJECT('key','canva_url','label','Canva link','type','url'),
         JSON_OBJECT('key','notes','label','Notes','type','text')
       ),
       90, 1, NOW()
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM resource_types WHERE name = 'Portfolio Asset');
