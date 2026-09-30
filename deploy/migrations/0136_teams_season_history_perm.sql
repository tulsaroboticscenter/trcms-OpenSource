-- 0136_teams_season_history_perm.sql
-- New permission: teams.season_history — "View a Team's Past Seasons".
-- Drives the season switcher on the team page (and gates loading a team-season
-- other than the team's current one, so the URL can't be used to walk around it).
-- Defaults to 'none' (Admin -> Role Management), so seed the staff roles that
-- should be able to look back at prior seasons. Grant any other role in the UI.
--
-- Keyed by role NAME (env-safe); only inserts where a row doesn't already exist.

INSERT INTO role_permissions (role_id, resource_key, level)
SELECT sr.id, 'teams.season_history', 'read'
  FROM system_roles sr
 WHERE sr.name IN ('Admin', 'System Administrator', 'Mentor')
   AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
         WHERE rp.role_id = sr.id AND rp.resource_key = 'teams.season_history');
