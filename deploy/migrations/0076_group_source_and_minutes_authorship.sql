-- 0076 — Auto-membership groups (YLC) + meeting-minutes edit authorship
--
-- A) member_groups.source: 'manual' (hand-picked list, the default) or 'ylc'
--    (membership is derived automatically from YLC role tags — youth_roles.
--    ylc_member = 1 — so being tagged YLC auto-joins the group). The seeded YLC
--    group becomes source='ylc'; its manual member box is hidden in the UI and
--    its events surface to every current YLC member's dashboard.
--
-- B) meetings.updated_by_id: track who last edited a meeting's minutes (we
--    already store created_by_id / created_at; this adds the editor).

ALTER TABLE member_groups
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual';

UPDATE member_groups SET source = 'ylc' WHERE name = 'YLC';

ALTER TABLE meetings
  ADD COLUMN updated_by_id INT NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0076', NOW());
