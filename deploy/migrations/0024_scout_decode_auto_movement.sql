-- DECODE match-form tweaks:
--  1) Starting position: rename 'gate' -> 'Goal' (value 'goal', label 'Goal'; 'far' -> 'Far').
--  2) Auto movement: replace the independent leave/did_not_move toggles with a single
--     mutually-exclusive choice — Leave | Moved, no Leave | Did Not Move.
-- Uses JSON_OBJECT/JSON_ARRAY (works on BOTH MariaDB (prod) and MySQL (dev); CAST(.. AS JSON)
-- is MySQL-only and errors on MariaDB). Idempotent.
UPDATE scout_seasons
SET config = JSON_SET(
      JSON_REMOVE(config, '$.matchForm.phases.auto.flags'),
      '$.matchForm.setup.startingPosition.options',
        JSON_ARRAY(JSON_OBJECT('key', 'goal', 'label', 'Goal'), JSON_OBJECT('key', 'far', 'label', 'Far')),
      '$.matchForm.phases.auto.movement',
        JSON_OBJECT('label', 'Auto movement', 'options',
          JSON_ARRAY(
            JSON_OBJECT('key', 'leave', 'label', 'Leave'),
            JSON_OBJECT('key', 'moved_no_leave', 'label', 'Moved, no Leave'),
            JSON_OBJECT('key', 'did_not_move', 'label', 'Did Not Move')
          ))
    )
WHERE code = 'DECODE';
