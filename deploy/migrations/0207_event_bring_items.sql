-- 0207 — "What are you bringing" / potluck sign-up for special events (e.g. season
-- kickoff party). Opt-in per event via events.bring_enabled. An organizer lists the
-- items they need with a quantity (Side Dishes x5, Desserts x4, …); attending members
-- sign up for what — and how many — they'll bring. Mirrors the event signup-slots
-- feature (0128). FK ON DELETE CASCADE, so deleting an event cleans these up.

ALTER TABLE events ADD COLUMN bring_enabled TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS event_bring_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  event_id      INT NOT NULL,
  name          VARCHAR(150) NOT NULL,
  qty_needed    INT NOT NULL DEFAULT 1,
  notes         VARCHAR(300) NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bring_item_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_bring_signups (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  event_id      INT NOT NULL,
  bring_item_id INT NULL,               -- NULL = an "Other" item not on the requested list
  member_id     INT NULL,               -- who is bringing it
  other_name    VARCHAR(150) NULL,      -- label when bring_item_id IS NULL
  qty           INT NOT NULL DEFAULT 1,
  note          VARCHAR(300) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bring_signup_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_bring_signup_item  FOREIGN KEY (bring_item_id) REFERENCES event_bring_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0207_event_bring_items', NOW());
