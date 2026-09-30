-- Fundraising events can benefit a season other than the one they occur in
-- (e.g. summer camp / golf tournament held between seasons, whose proceeds fund
-- the UPCOMING season's team budgets). NULL = benefits the current/in-season budget.
ALTER TABLE events
  ADD COLUMN benefits_season VARCHAR(20) NULL AFTER fundraising_opportunity;

-- Lock a youth's fundraising earning to the team it was posted to, so a later
-- re-finalize (or the youth changing teams / graduating) never relocates money
-- that already belongs to a team. Set at finalize; authoritative once present.
ALTER TABLE event_member_distribution
  ADD COLUMN locked_at DATETIME NULL AFTER team_season_id;

INSERT IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('0061_event_benefits_season', NOW());
