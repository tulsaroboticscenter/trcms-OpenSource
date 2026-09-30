-- Watchlist (#planning): scouters tag teams as potential alliance partners and
-- arrange them into two preference columns (Far Partner / Goal Partner) in ranked
-- order. Shared across ALL scouters (lives on the per-event roster, like the
-- pit/match priority flags) so anyone can see and adjust the picks.
--   watchlist      = on the watchlist (tagged from the Teams page).
--   watch_column   = 'far' | 'goal' | NULL (NULL = watchlisted but not yet sorted).
--   watch_rank     = order within the group, lower = higher preference (0-based).
-- Plain ALTER ADD COLUMN — compatible with both MySQL (dev) and MariaDB (prod).
ALTER TABLE scout_event_teams
  ADD COLUMN watchlist TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN watch_column VARCHAR(8) NULL,
  ADD COLUMN watch_rank INT NULL;
