-- 0194 — FDP cert-matching. A team can record which certifications it wants in the youth it
-- interviews; the eligible list then shows, per youth, which of those the youth already holds.

CREATE TABLE IF NOT EXISTS team_season_cert_needs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  team_season_id   INT NOT NULL,
  certification_id INT NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tscn (team_season_id, certification_id),
  KEY idx_tscn_team (team_season_id),
  CONSTRAINT fk_tscn_team FOREIGN KEY (team_season_id)   REFERENCES team_seasons (id)   ON DELETE CASCADE,
  CONSTRAINT fk_tscn_cert FOREIGN KEY (certification_id) REFERENCES certifications (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
