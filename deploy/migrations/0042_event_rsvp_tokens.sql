-- 0042 Event RSVP tokens (feedback #96)
-- Lets a member RSVP to an event straight from an email (no login) by clicking a
-- tokenised link. One stable token per (event × member) — reused across re-sends
-- — that resolves to the member and upserts their event_participants.status.

CREATE TABLE IF NOT EXISTS event_rsvp_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id   INT NOT NULL,
  member_id  INT NOT NULL,
  token      VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_evt_rsvp_member (event_id, member_id),
  UNIQUE KEY uq_evt_rsvp_token (token),
  CONSTRAINT fk_evt_rsvp_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_evt_rsvp_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0042_event_rsvp_tokens', NOW());
