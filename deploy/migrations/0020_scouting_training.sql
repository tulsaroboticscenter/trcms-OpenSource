-- Scouting Training Mode (#61): replay a finished, video-posted event as if live —
-- scout each match, then press "Score Match" to reveal the real result and check
-- your scouting against ground truth. is_training marks the event; scout_matches
-- caches the actual red/blue score but keeps it hidden until revealed per match.
ALTER TABLE scout_events
  ADD COLUMN is_training TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE scout_matches
  ADD COLUMN red_score INT DEFAULT NULL,
  ADD COLUMN blue_score INT DEFAULT NULL,
  ADD COLUMN revealed TINYINT(1) NOT NULL DEFAULT 0;
