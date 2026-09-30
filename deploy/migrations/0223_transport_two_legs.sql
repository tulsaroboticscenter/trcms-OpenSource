-- 0223 — Split each event transportation answer into two legs: a ride TO the event and a
-- ride BACK. Each leg is have | need | drive | not_sure. Vehicle assignment is now per leg
-- (a rider can be seated in one driver's car going there and a different one coming back).
ALTER TABLE event_transport_responses
  MODIFY response varchar(20) NULL,
  ADD COLUMN ride_to  varchar(20) NULL AFTER response,
  ADD COLUMN ride_back varchar(20) NULL AFTER ride_to,
  ADD COLUMN assigned_driver_to_id   INT NULL AFTER assigned_driver_id,
  ADD COLUMN assigned_driver_back_id INT NULL AFTER assigned_driver_to_id;

-- Backfill existing single-answer rows: apply the old answer to both legs.
UPDATE event_transport_responses SET
  ride_to = CASE response
      WHEN 'have_ride' THEN 'have' WHEN 'need_ride' THEN 'need'
      WHEN 'can_drive' THEN 'drive' WHEN 'not_sure' THEN 'not_sure' ELSE ride_to END,
  ride_back = CASE response
      WHEN 'have_ride' THEN 'have' WHEN 'need_ride' THEN 'need'
      WHEN 'can_drive' THEN 'drive' WHEN 'not_sure' THEN 'not_sure' ELSE ride_back END
  WHERE ride_to IS NULL AND response IS NOT NULL;

-- Carry any existing assignment onto the "to" leg.
UPDATE event_transport_responses
   SET assigned_driver_to_id = assigned_driver_id
 WHERE assigned_driver_id IS NOT NULL AND assigned_driver_to_id IS NULL;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0223_transport_two_legs', NOW());
