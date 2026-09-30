-- Mentors can be tagged with the program(s) they support (many-to-many). Drives
-- "program mentors" in group email, independent of team-roster membership.
CREATE TABLE IF NOT EXISTS member_program_support (
  id INT NOT NULL AUTO_INCREMENT,
  member_id INT NOT NULL,
  program_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_member_program (member_id, program_id),
  KEY idx_mps_member (member_id),
  KEY idx_mps_program (program_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
