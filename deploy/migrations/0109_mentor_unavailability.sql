-- 0109 — Mentor unavailability. Informational travel / out-of-office date ranges
-- mentors log on the Events Calendar. Not events (no RSVP/logistics). Visibility
-- is enforced in the controller: Admin / System Administrator / Mentor - Lead see
-- everyone's; every mentor sees only their own.

CREATE TABLE IF NOT EXISTS mentor_unavailability (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  member_id   INT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  note        VARCHAR(300) NULL,
  created_by_id INT NULL,
  created_at  DATETIME NOT NULL,
  updated_at  DATETIME NULL,
  KEY idx_mu_member (member_id),
  KEY idx_mu_range (start_date, end_date),
  CONSTRAINT fk_mu_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0109', NOW());
