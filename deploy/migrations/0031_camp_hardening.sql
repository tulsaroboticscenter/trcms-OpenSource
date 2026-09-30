-- Summer Camp pre-launch hardening:
--  • waiver_snapshot — store the exact waiver wording a parent agreed to, captured
--    at submit time, so an agreement stays self-documenting even if the season's
--    waiver text is later edited (it's a minors' liability waiver — legal record).
--  • camp_submit_log — a tiny per-IP log so the PUBLIC registration endpoint can
--    rate-limit abusive/spammy submissions (IP is stored hashed, not in the clear).
ALTER TABLE camp_registrations
  ADD COLUMN waiver_snapshot TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS camp_submit_log (
  id INT NOT NULL AUTO_INCREMENT,
  ip_hash VARCHAR(64) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY camp_submit_ip (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
