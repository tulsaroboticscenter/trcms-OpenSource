-- #87: record the date a grant was submitted for a specific team (alongside the
-- existing per-team "submitted" flag).
ALTER TABLE grant_teams ADD COLUMN submitted_date DATE NULL AFTER submitted;
