-- Let the FLL director remove a family from the Season Planning list entirely.
--
-- The dashboard list is computed live from eligibility (age band + interest signals),
-- so there was no way to take a family off it permanently — a family that doesn't
-- belong (moved away, aging out, declined, a stale duplicate) kept reappearing on
-- every reload. This records a per-season, per-program exclusion so a removed family
-- stays gone until it's explicitly restored.
--
-- fam_key mirrors how the dashboard groups people: a POSITIVE value is a real
-- families.id; a NEGATIVE value is -(the youth's member_id) for a youth with no
-- family record. program_id 0 means "no specific program".
CREATE TABLE IF NOT EXISTS season_planning_exclusions (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  season        VARCHAR(10) NOT NULL,
  program_id    INT NOT NULL DEFAULT 0,
  fam_key       INT NOT NULL,
  family_name   VARCHAR(200) NULL,
  reason        VARCHAR(255) NULL,
  created_by_id INT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_spx (season, program_id, fam_key)
);
