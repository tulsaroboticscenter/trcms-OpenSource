-- Pre-event scouting strategy (#planning): flag teams to prioritize for pit and
-- match scouting. Two independent flags on the per-event roster so a team can be a
-- pit-scout target without being a match-scout target (and vice versa). Survives
-- sync-preevent re-pulls (cachePreEvent's upsert only touches team_name).
ALTER TABLE scout_event_teams
  ADD COLUMN pit_priority TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN match_priority TINYINT(1) NOT NULL DEFAULT 0;
