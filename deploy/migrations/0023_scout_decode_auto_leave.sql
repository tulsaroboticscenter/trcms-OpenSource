-- Add an auto "Leave" toggle to the DECODE match-scouting form, to the LEFT of
-- "Did Not Move" (index 0 of auto.flags). Idempotent: only inserts if not already
-- present. The form engine renders flags from config, so no code change is needed.
UPDATE scout_seasons
SET config = JSON_ARRAY_INSERT(config, '$.matchForm.phases.auto.flags[0]', 'leave')
WHERE code = 'DECODE'
  AND JSON_SEARCH(config, 'one', 'leave', NULL, '$.matchForm.phases.auto.flags') IS NULL;
