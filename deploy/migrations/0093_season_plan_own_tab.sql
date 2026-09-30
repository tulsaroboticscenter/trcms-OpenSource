-- 0093 — Give the Season Plan its own team-profile tab. Moves the plan pane out of
-- the shared "Season" tab into a dedicated "Season Plan" tab, and places the new
-- Issue Log and Team Roles panes alongside it. Only touches an existing saved
-- team_pane_tabs config; when none exists the code defaults already do this.

UPDATE system_config
   SET `values` = JSON_SET(`values`,
        '$.plan', 'season_plan',
        '$.issues', 'season_plan',
        '$.teamroles', 'season_plan')
 WHERE category = 'team_pane_tabs';

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0093', NOW());
