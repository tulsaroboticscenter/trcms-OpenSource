-- 0090 — Team Deadlines (Release 3.5, #125). A team-defined milestone/deadline on
-- the season plan (e.g. "Ready for League Meet"), optionally linked to a calendar
-- event so its date follows the event. Shown on the plan and the Gantt timeline so
-- teams can build their schedule around key dates. Deadlines are fixed targets and
-- are NOT moved by the auto-reschedule engine.

CREATE TABLE IF NOT EXISTS season_deadlines (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id INT NOT NULL,
  name           VARCHAR(200) NOT NULL,
  deadline_date  DATE NOT NULL,
  event_id       INT NULL,               -- optional link to an Events Calendar event
  notes          TEXT NULL,
  created_by_id  INT NULL,
  created_at     DATETIME NULL,
  updated_at     DATETIME NULL,
  KEY idx_sd_team (team_season_id),
  CONSTRAINT fk_sd_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0090', NOW());
