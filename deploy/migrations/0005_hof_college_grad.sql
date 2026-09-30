-- Hall of Fame: track college/trade-school graduation year and whether the
-- member is still in school.
ALTER TABLE hof_members
  ADD COLUMN college_grad_year INT NULL,
  ADD COLUMN still_in_school TINYINT(1) NOT NULL DEFAULT 0;
