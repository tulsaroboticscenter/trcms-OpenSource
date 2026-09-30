-- Camp staffing visibility: tie the people who CHECK IN to a camp's linked
-- calendar event to a specific camp (FLL vs FTC) within that week. Check-in and
-- hours come from the existing `checkins` table on the event — this table only
-- records the per-camp assignment (a worker can be tagged to more than one camp
-- in the same week = a "floater"). It is NOT a check-in mechanism.
CREATE TABLE IF NOT EXISTS camp_worker_assignments (
  id INT NOT NULL AUTO_INCREMENT,
  session_id INT NOT NULL,            -- the camp (camp_sessions.id) the worker is tagged to
  member_id INT NOT NULL,             -- the worker (members.id) — they appear via event check-ins
  role VARCHAR(60) DEFAULT NULL,      -- optional label (Lead, Helper, Mentor…)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_worker_camp (session_id, member_id),
  KEY idx_cwa_session (session_id),
  KEY idx_cwa_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
