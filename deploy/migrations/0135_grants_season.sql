-- 0135_grants_season.sql
-- Grants had no season of their own — a grant's SEASON was implied by which
-- team-season its grant_teams row pointed at. That made "this grant is for
-- 2026-2027" impossible to state directly: a grant raised any time for the
-- upcoming season silently attached to whatever season the team picker resolved
-- to, and never showed on the intended season's budgets.
--
-- Give a grant an explicit season (mirrors events.benefits_season). Changing it
-- re-points the grant's team links onto that season's team-seasons, preserving
-- amount requested / outcome / award. NULL = legacy grant, season inferred from
-- its existing team links (left alone).

ALTER TABLE grants
  ADD COLUMN season VARCHAR(10) DEFAULT NULL AFTER status;

CREATE INDEX idx_grants_season ON grants (season);

-- Backfill: adopt the season of each grant's existing team link, so historical
-- grants keep showing exactly where they already show.
UPDATE grants g
   JOIN (
        SELECT gt.grant_id, MAX(ts.season) AS season
          FROM grant_teams gt
          JOIN team_seasons ts ON ts.id = gt.team_season_id
         WHERE gt.team_season_id IS NOT NULL
         GROUP BY gt.grant_id
   ) x ON x.grant_id = g.id
    SET g.season = x.season
  WHERE g.season IS NULL;
