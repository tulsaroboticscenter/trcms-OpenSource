-- 0107 — Scheduled reports (Reports Engine Phase 3). A saved report can be
-- emailed on a cadence (daily / weekly / monthly) to a list of recipients. A
-- cron runs bin/run_report_schedules.php, which runs each due report AS ITS
-- OWNER (their field-tier + row-scope entitlement), renders an HTML table plus
-- a CSV attachment, emails it, and advances next_run_at.
--
-- day_of_week (0=Sun..6=Sat) applies to weekly; day_of_month (1..28) to monthly.
-- team_season_id, when set, scopes the report to one team (as the team tab does).
-- params holds any runtime parameter values as JSON.

CREATE TABLE IF NOT EXISTS report_schedules (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  definition_id     INT NOT NULL,
  owner_id          INT NULL,
  cadence           ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'weekly',
  day_of_week       TINYINT NULL,
  day_of_month      TINYINT NULL,
  send_hour         TINYINT NOT NULL DEFAULT 6,
  recipient_emails  TEXT NOT NULL,
  team_season_id    INT NULL,
  params            JSON NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at       DATETIME NULL,
  next_run_at       DATETIME NULL,
  created_at        DATETIME NOT NULL,
  KEY idx_rs_due (is_active, next_run_at),
  KEY idx_rs_def (definition_id),
  CONSTRAINT fk_rs_def FOREIGN KEY (definition_id) REFERENCES report_definitions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0107', NOW());
