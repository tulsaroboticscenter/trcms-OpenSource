-- Replace the placeholder scout_pit_photos table (never populated) with a cleaner
-- scout_robot_photos table that links directly to (event, team) instead of a specific
-- pit report. This makes photo upload independent of the offline queue — photos are
-- uploaded online any time during pit scouting and are shared across all scouters.
-- One photo per team per event can be flagged is_profile=1; it appears as the "cover"
-- image on every team report and watchlist pull-up.

ALTER TABLE scout_pit_photos DROP FOREIGN KEY scout_pit_photos_ibfk_1;
DROP TABLE IF EXISTS scout_pit_photos;

CREATE TABLE IF NOT EXISTS scout_robot_photos (
  id                    INT NOT NULL AUTO_INCREMENT,
  scout_event_id        INT NOT NULL,
  team_number           INT NOT NULL,
  file_path             VARCHAR(255) NOT NULL,           -- served at /uploads/{filename}
  is_profile            TINYINT(1) NOT NULL DEFAULT 0,   -- only one per (event, team)
  uploaded_by_member_id INT DEFAULT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_robot_photo_event_team (scout_event_id, team_number),
  CONSTRAINT robot_photos_event_fk  FOREIGN KEY (scout_event_id)        REFERENCES scout_events (id) ON DELETE CASCADE,
  CONSTRAINT robot_photos_member_fk FOREIGN KEY (uploaded_by_member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
