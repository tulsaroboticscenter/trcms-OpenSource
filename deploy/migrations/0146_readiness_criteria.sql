-- Season Strategy — Inspire/Impact Readiness (Phase 4). A config table of the "Six
-- Separators" of world-class award teams. Scores are computed on READ from the team's
-- real data (goals, portfolio pieces, captures, mission, certifications) — no per-team
-- score is stored. Weights/labels are admin-tunable here.
CREATE TABLE IF NOT EXISTS readiness_criteria (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  crit_key    VARCHAR(40) NOT NULL,
  label       VARCHAR(120) NOT NULL,
  description VARCHAR(400) NULL,
  weight      INT NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_key (crit_key)
);

INSERT INTO readiness_criteria (crit_key, label, description, weight, sort_order) VALUES
  ('one_story',           'One Story',            'A clear team mission with narrative portfolio pieces drafted.', 1, 1),
  ('measured_impact',     'Measured Impact',      'Outreach & impact goals with a real metric and progress toward it.', 1, 2),
  ('engineering_process', 'Engineering Process',  'A steady habit of documenting design decisions and test results.', 1, 3),
  ('everyone_owns_it',    'Everyone Owns It',     'Ownership and skills spread across the team, not one or two people.', 1, 4),
  ('sustainability',      'Sustainability',       'A sustainability story and goals to grow or mentor other teams.', 1, 5),
  ('felt_evidence',       'Felt + Evidence',      'Captures backed by real evidence, not just narrative.', 1, 6)
ON DUPLICATE KEY UPDATE label = VALUES(label);
