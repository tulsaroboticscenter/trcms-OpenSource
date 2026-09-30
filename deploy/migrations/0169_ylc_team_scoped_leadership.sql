-- Tie team-level YLC roles (Team Leader, Vice Captain, Quartermaster) to a specific team.
--
-- Problem: ylc_memberships was keyed by member + term only, so a "Team Leader" role had
-- no team. A youth on multiple teams (an FTC/FRC crossover) showed as that team's leader
-- on EVERY team they were on. And the model allowed only one YLC role per member per
-- term, so a youth couldn't be Team Leader on one team and hold a role on another.
--
-- Fix: add team_id. A team-level role now carries the team it belongs to; program-wide
-- council offices (President, Secretary, Treasurer, At Large, …) keep team_id NULL. A
-- youth may now hold several rows in a term — at most one per team, plus a council row.
-- The team leadership pane matches on team_id so a role only shows on its own team.
ALTER TABLE ylc_memberships
  ADD COLUMN team_id INT NULL AFTER member_id,
  ADD CONSTRAINT fk_ylc_team FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE SET NULL;

CREATE INDEX idx_ylc_team_term ON ylc_memberships (team_id, term);

-- Backfill the unambiguous cases: a team-level role held by a youth who was on exactly
-- ONE team that season gets that team set automatically. Crossover youth on more than one
-- team are left NULL on purpose — which team they lead is a human decision, made on each
-- team's page. Uses the default team-level role names (the config defaults); any renamed
-- roles can be reassigned from the team page.
UPDATE ylc_memberships y
  JOIN (
    SELECT tma.member_id, ts.season,
           MIN(ts.team_id) AS team_id,
           COUNT(DISTINCT ts.team_id) AS team_count
      FROM team_member_assignments tma
      JOIN team_seasons ts ON ts.id = tma.team_season_id
     GROUP BY tma.member_id, ts.season
  ) t ON t.member_id = y.member_id AND t.season = y.term AND t.team_count = 1
   SET y.team_id = t.team_id
 WHERE y.team_id IS NULL
   AND y.role IN ('Team Leader', 'Vice Captain', 'Vice President', 'Quartermaster');
