-- Vendor/warranty correspondence log on a repair ticket. Distinct from the
-- internal progress log (repair_updates): this captures back-and-forth with a
-- vendor about repair details, warranty claims, RMAs and returns — with a
-- direction, channel, contact, and a reference number (RMA / case / warranty #).
CREATE TABLE IF NOT EXISTS repair_correspondence (
  id INT NOT NULL AUTO_INCREMENT,
  ticket_id INT NOT NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'outgoing',   -- outgoing | incoming | note
  channel VARCHAR(20) NOT NULL DEFAULT 'email',        -- email | phone | portal | mail | chat | other
  contact_name VARCHAR(200) NULL,                      -- who at the vendor
  vendor_id INT NULL,                                  -- optional link to inv_vendors
  subject VARCHAR(300) NULL,
  body TEXT NULL,
  reference VARCHAR(150) NULL,                          -- RMA / case / warranty / tracking #
  corresponded_on DATE NULL,                            -- when it actually happened
  member_id INT NULL,                                   -- who logged it
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rc_ticket (ticket_id),
  KEY idx_rc_vendor (vendor_id),
  CONSTRAINT fk_rc_ticket FOREIGN KEY (ticket_id) REFERENCES repair_tickets (id) ON DELETE CASCADE,
  CONSTRAINT fk_rc_vendor FOREIGN KEY (vendor_id) REFERENCES inv_vendors (id) ON DELETE SET NULL,
  CONSTRAINT fk_rc_member FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
