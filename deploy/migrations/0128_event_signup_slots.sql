-- 0128_event_signup_slots.sql
-- #152: SignupGenius-style coverage sign-ups on an event. An organizer defines
-- slots — a coverage area (e.g. "3D Printing", "Front Desk") and/or a time window,
-- each with a capacity (how many people are needed). Members then sign themselves
-- up for the slots they can cover, so a big multi-area event (e.g. Maker Faire)
-- can be staffed even when people are only available for certain times.

CREATE TABLE IF NOT EXISTS event_signup_slots (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  event_id    INT NOT NULL,
  area        VARCHAR(200) NULL,          -- coverage area / station (optional)
  title       VARCHAR(200) NULL,          -- extra label for the slot (optional)
  slot_date   DATE NULL,                  -- for multi-day events (optional)
  start_time  TIME NULL,
  end_time    TIME NULL,
  capacity    INT NOT NULL DEFAULT 1,     -- 0 = unlimited
  notes       VARCHAR(400) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL,
  INDEX idx_ess_event (event_id),
  CONSTRAINT fk_ess_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_signup_responses (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  slot_id     INT NOT NULL,
  member_id   INT NULL,                   -- the volunteer (NULL for a guest)
  guest_name  VARCHAR(200) NULL,          -- non-member volunteer name
  notes       VARCHAR(400) NULL,
  created_by_id INT NULL,
  created_at  DATETIME NOT NULL,
  INDEX idx_esr_slot (slot_id),
  INDEX idx_esr_member (member_id),
  CONSTRAINT fk_esr_slot FOREIGN KEY (slot_id) REFERENCES event_signup_slots(id) ON DELETE CASCADE
);

-- A member can hold a given slot only once.
CREATE UNIQUE INDEX uq_esr_slot_member ON event_signup_responses (slot_id, member_id);
