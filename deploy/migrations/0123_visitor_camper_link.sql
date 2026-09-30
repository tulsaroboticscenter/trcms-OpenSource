-- 0123_visitor_camper_link.sql
-- #141: document a camper's visit without re-entering their info. Link a visitor
-- record to the camp `campers` row it was created from, so repeat visits log onto
-- the same visitor record instead of creating duplicates.
ALTER TABLE visitors
  ADD COLUMN camper_id INT NULL AFTER converted_member_id,
  ADD INDEX idx_visitors_camper (camper_id);
