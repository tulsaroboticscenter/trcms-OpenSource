-- Did-Not-Show flag on event teams: set via pit scouting, filters team from all views.
ALTER TABLE scout_event_teams ADD COLUMN did_not_show TINYINT(1) NOT NULL DEFAULT 0;

-- Add robot weight (lbs) to the FTC DECODE pit form Robot Capabilities group.
-- Inserts after dimH (existing length/width/height fields).
UPDATE scout_seasons
SET config = JSON_INSERT(
  config,
  '$.pitForm[0].fields[13]',
  JSON_OBJECT('key', 'dimWeight', 'label', 'Weight (lbs)', 'type', 'decimal')
),
updated_at = NOW()
WHERE program = 'FTC' AND code = 'DECODE';
