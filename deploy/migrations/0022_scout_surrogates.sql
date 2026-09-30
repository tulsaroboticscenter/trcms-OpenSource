-- Surrogate teams (#scouting): a surrogate plays a match to fill out the schedule but
-- earns no W/L credit and the match doesn't count toward its stats. Store the surrogate
-- team numbers per match (comma-separated) so projected standings can exclude them while
-- still counting their OPR toward the alliance's projected score.
ALTER TABLE scout_matches
  ADD COLUMN surrogates VARCHAR(60) DEFAULT NULL;
