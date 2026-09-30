-- 0099 — Tie a room/resource reservation to an event (e.g. reserve the computer
-- lab for a CAD class). The event page can then show its reserved resources, and
-- a reservation can show which event it's for. Deleting the event unlinks (keeps
-- the reservation).

ALTER TABLE reservations
  ADD COLUMN event_id INT NULL AFTER team_season_id,
  ADD CONSTRAINT fk_resv_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX idx_resv_event ON reservations (event_id);

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0099', NOW());
