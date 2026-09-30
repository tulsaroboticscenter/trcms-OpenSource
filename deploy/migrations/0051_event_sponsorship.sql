-- 0051_event_sponsorship.sql — Event Sponsorship (2.1)
-- Lets an event be opened for sponsorship with configurable packages and a
-- sponsor pipeline (interest → commitment → fulfilment). Ties into the Sponsors
-- module; dollars are tracked per pipeline entry and summarised on the event.

ALTER TABLE events
  ADD COLUMN is_sponsorable            TINYINT(1) NOT NULL DEFAULT 0 AFTER fundraising_opportunity,
  ADD COLUMN sponsorship_deadline      DATE NULL AFTER is_sponsorable,
  ADD COLUMN sponsorship_goal          DECIMAL(12,2) NULL AFTER sponsorship_deadline,
  ADD COLUMN sponsorship_owning_team_id INT NULL AFTER sponsorship_goal;  -- NULL = program-run

CREATE TABLE IF NOT EXISTS event_sponsorship_packages (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  event_id           INT NOT NULL,
  name               VARCHAR(120) NOT NULL,
  price              DECIMAL(12,2) NULL,
  quantity_available INT NULL,               -- NULL = unlimited
  benefits           TEXT NULL,
  display_order      INT NOT NULL DEFAULT 0,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_esp_event (event_id),
  CONSTRAINT fk_esp_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS event_sponsorships (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  event_id              INT NOT NULL,
  sponsor_id            INT NOT NULL,
  package_id            INT NULL,
  stage                 ENUM('prospect','invited','interested','committed','fulfilled','declined') NOT NULL DEFAULT 'interested',
  pledged_amount        DECIMAL(12,2) NULL,
  received_amount       DECIMAL(12,2) NULL,
  in_kind_description   TEXT NULL,
  received_date         DATE NULL,
  relationship_owner_id INT NULL,
  notes                 TEXT NULL,
  created_by_id         INT NULL,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_sponsor (event_id, sponsor_id),
  KEY idx_es_event (event_id),
  CONSTRAINT fk_es_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_es_sponsor FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE,
  CONSTRAINT fk_es_package FOREIGN KEY (package_id) REFERENCES event_sponsorship_packages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Allow a sponsor contribution to reference the event it came from (future linking).
ALTER TABLE sponsor_contributions ADD COLUMN event_id INT NULL AFTER season;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0051_event_sponsorship', NOW());
