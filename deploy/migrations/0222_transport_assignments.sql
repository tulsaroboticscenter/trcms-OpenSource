-- 0222 — Assign riders to vehicles for event transportation. A member who answered "I need a
-- ride" can be assigned to a driver who answered "I can drive others" (up to that driver's open
-- seats). The assignment is stored on the rider's response row.
ALTER TABLE event_transport_responses
  ADD COLUMN assigned_driver_id INT NULL AFTER seats_available;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0222_transport_assignments', NOW());
