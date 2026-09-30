-- FLL Season Planning: night-first planning.
-- A per-night "holding" bucket lets youth/mentors be assigned to a NIGHT before
-- they're split into named teams. is_holding=1 marks that container; real teams
-- are is_holding=0 and are what "supports N teams" / publish count.
ALTER TABLE plan_night_teams
  ADD COLUMN is_holding TINYINT(1) NOT NULL DEFAULT 0 AFTER based_on_team_id;
