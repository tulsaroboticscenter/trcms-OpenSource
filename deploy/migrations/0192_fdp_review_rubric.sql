-- 0192 — FDP board-of-review rubric. Stores the panel's structured scores for a youth's
-- board review alongside the existing outcome/notes. JSON kept as TEXT (portable across
-- MySQL/MariaDB): a { "<criterion>": <1-4> } map. The criteria list is admin-configurable
-- in system_config (category 'fdp_review_rubric'); a code default is used when unset.

ALTER TABLE fdp_progress
  ADD COLUMN board_review_scores TEXT NULL AFTER board_review_notes;
