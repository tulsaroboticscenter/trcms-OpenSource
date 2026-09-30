-- 0122_team_page_theme.sql
-- Team-page theming (Release 3.11). A team captain (or anyone granted the new
-- teams.theme permission) plus mentors/admins can pick a curated theme preset,
-- a font pairing, and an accent color for their team page.
ALTER TABLE team_seasons
  ADD COLUMN theme_preset VARCHAR(40) NULL AFTER team_photo_url,
  ADD COLUMN theme_font   VARCHAR(40) NULL AFTER theme_preset,
  ADD COLUMN theme_accent VARCHAR(20) NULL AFTER theme_font;
