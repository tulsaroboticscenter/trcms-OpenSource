-- 0121_event_default_activities.sql
-- Event default check-in activities (Release 3.11).
-- Per event, a default activity area for each member type used to pre-fill the
-- activity dropdown at check-in. Empty / NULL = "no default" (parents who just
-- hang out get no auto-logged time entry). The chosen area is stored on the
-- check-in and, at check-out, auto-creates the member's time-log entry.

ALTER TABLE events
  ADD COLUMN default_area_youth  VARCHAR(120) NULL AFTER requires_logistics,
  ADD COLUMN default_area_adult  VARCHAR(120) NULL AFTER default_area_youth,
  ADD COLUMN default_area_parent VARCHAR(120) NULL AFTER default_area_adult;

ALTER TABLE checkins
  ADD COLUMN activity_area VARCHAR(120) NULL AFTER notes;
