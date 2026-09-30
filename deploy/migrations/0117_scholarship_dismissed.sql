-- Per-youth "Not Eligible / not for me" dismissals, so a youth can hide
-- scholarships that don't apply to them (e.g. "dependents of Acme employees")
-- and stop seeing them on the board. Mirror of college_scholarship_follows.
CREATE TABLE IF NOT EXISTS college_scholarship_dismissed (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  scholarship_id INT NOT NULL,
  member_id      INT NOT NULL,
  created_at     DATETIME NULL,
  UNIQUE KEY uq_cdismiss (scholarship_id, member_id),
  KEY idx_cdismiss_member (member_id),
  CONSTRAINT fk_cdismiss_sch FOREIGN KEY (scholarship_id) REFERENCES college_scholarships(id) ON DELETE CASCADE,
  CONSTRAINT fk_cdismiss_mem FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
