-- 0221 — Event transportation planning. For off-site events an organizer can turn on a
-- "How will you get to this event?" question; each member answers once (have a ride / need a
-- ride / can drive others (+ seats) / not sure), so a coordinator can match riders to drivers.
-- Mirrors the "what are you bringing" opt-in pattern (events.bring_enabled + a responses table).

ALTER TABLE events ADD COLUMN transport_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER bring_enabled;

CREATE TABLE IF NOT EXISTS event_transport_responses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  event_id        INT NOT NULL,
  member_id       INT NOT NULL,
  response        VARCHAR(20) NOT NULL,           -- have_ride | need_ride | can_drive | not_sure
  seats_available INT NULL,                        -- when response = can_drive
  note            VARCHAR(300) NULL,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_member (event_id, member_id),
  CONSTRAINT fk_transport_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0221_event_transportation', NOW());
