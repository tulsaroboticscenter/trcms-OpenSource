-- 0074 — Remove the standalone Tasks module tables.
-- The short-lived standalone Tasks area (migration 0069) duplicated the existing
-- TRC/Team Tasks board (team_tasks, PlanningController). We consolidated on the
-- existing board and removed the standalone module, its controller, routes, and
-- UI. YLC meeting action items no longer mirror into these tables. Drop them.
--
-- Safe: nothing references these tables after this release. meeting_action_items
-- keeps its now-unused task_id column (always NULL); harmless, left in place.

DROP TABLE IF EXISTS task_rotation_teams;
DROP TABLE IF EXISTS tasks;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0074', NOW());
