-- Season Strategy — Goals module, Phase 1 (Goals MVP + mission field).
-- Team-scoped measurable season goals with an owner, a metric/target, a progress
-- log, and an auto-derived at-risk status (computed on read). Portfolio & Readiness
-- are later phases and not created here.

-- §4.1 — one-sentence team mission (feeds the workshop + later Readiness "one story").
ALTER TABLE team_seasons ADD COLUMN mission TEXT NULL AFTER team_name;

-- §4.2 — goals
CREATE TABLE IF NOT EXISTS season_goals (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id     INT NOT NULL,
  season             VARCHAR(10) NULL,
  title              VARCHAR(255) NOT NULL,
  description        TEXT NULL,
  category           ENUM('robot','outreach','portfolio','team','fundraising','competition','skills','other') NOT NULL DEFAULT 'other',
  owner_member_id    INT NULL,
  metric_type        ENUM('count','currency','percent','hours','milestone') NOT NULL DEFAULT 'count',
  target_value       DECIMAL(12,2) NULL,
  current_value      DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit               VARCHAR(40) NULL,
  metric_source      ENUM('manual','impact_hours','budget','outreach_events','task_progress','certifications') NOT NULL DEFAULT 'manual',
  start_date         DATE NULL,
  due_date           DATE NULL,
  priority           ENUM('low','med','high') NOT NULL DEFAULT 'med',
  status             ENUM('draft','active','at_risk','achieved','missed','archived') NOT NULL DEFAULT 'draft',
  linked_deadline_id INT NULL,             -- link only → season_deadlines (no auto-create)
  created_by_id      INT NULL,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_team_season (team_season_id),
  KEY idx_owner (owner_member_id)
);

-- §4.2 — progress log (mirrors My Time / % Complete)
CREATE TABLE IF NOT EXISTS season_goal_updates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  goal_id     INT NOT NULL,
  member_id   INT NULL,
  value       DECIMAL(12,2) NULL,          -- the new current_value at this update
  note        TEXT NULL,
  evidence_id INT NULL,                     -- strategy_evidence (Phase 3); nullable for now
  logged_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_goal (goal_id)
);
