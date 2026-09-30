-- 0040 Repair / Maintenance Ticket system (feedback #90)
-- Members report broken equipment; a fixer is assigned and walks the ticket
-- through a maintenance status workflow. Optionally links to a tracked asset
-- in inventory so the repair history follows the item.

CREATE TABLE IF NOT EXISTS repair_tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(300) NOT NULL,
  description     TEXT NULL,
  equipment_name  VARCHAR(200) NULL,          -- free-text equipment if not a tracked asset
  inv_item_id     INT NULL,                   -- optional link to a tracked inventory asset
  kind            VARCHAR(20) NOT NULL DEFAULT 'repair',  -- repair | maintenance
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending,maintenance,in_progress,waiting_parts,testing,complete,closed
  priority        VARCHAR(20) NOT NULL DEFAULT 'normal',  -- low,normal,high,urgent
  location_id     INT NULL,                   -- where the equipment lives (inv_locations)
  reported_by_id  INT NULL,
  reported_date   DATE NULL,
  assigned_to_id  INT NULL,
  completed_date  DATE NULL,
  resolution      TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_repair_status (status),
  KEY idx_repair_assigned (assigned_to_id),
  KEY idx_repair_item (inv_item_id),
  CONSTRAINT fk_repair_item FOREIGN KEY (inv_item_id) REFERENCES inv_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_repair_reporter FOREIGN KEY (reported_by_id) REFERENCES members(id) ON DELETE SET NULL,
  CONSTRAINT fk_repair_assignee FOREIGN KEY (assigned_to_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Progress log: every comment and every status change is one row, so the
-- ticket shows a chronological repair history.
CREATE TABLE IF NOT EXISTS repair_updates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT NOT NULL,
  member_id   INT NULL,
  body        TEXT NULL,
  old_status  VARCHAR(20) NULL,
  new_status  VARCHAR(20) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rupd_ticket (ticket_id),
  CONSTRAINT fk_rupd_ticket FOREIGN KEY (ticket_id) REFERENCES repair_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_rupd_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO schema_migrations (version, applied_at)
VALUES ('0040_repair_tickets', NOW());
