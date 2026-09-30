-- Store the TRC competing team number on the scouting event so the
-- Alliance Picker can auto-populate "Your team #" without manual entry.
ALTER TABLE scout_events ADD COLUMN our_team_number INT NULL DEFAULT NULL;
