-- 0096 — Wish List module. Things TRC (or a specific team) would like to acquire.
-- Each item can link to an external vendor page (Amazon, etc.), carry a price and
-- priority, and be marked fulfilled by a donation — donor is a member, a sponsor,
-- or a free-form name. When the fulfilled item is an asset (not a part) it can spawn
-- an inventory asset carrying that donation for the life of the asset.

CREATE TABLE IF NOT EXISTS wish_list_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  scope              ENUM('trc','team') NOT NULL DEFAULT 'trc',
  team_season_id     INT NULL,                 -- set when scope='team'
  name               VARCHAR(200) NOT NULL,
  description        TEXT NULL,
  url                VARCHAR(500) NULL,         -- external vendor link
  price              DECIMAL(10,2) NULL,
  quantity           INT NOT NULL DEFAULT 1,
  priority           ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  is_asset           TINYINT(1) NOT NULL DEFAULT 1,   -- fulfilling creates an asset vs. a part
  status             ENUM('open','fulfilled','archived') NOT NULL DEFAULT 'open',
  -- fulfillment / donation
  fulfilled_date     DATE NULL,
  fulfilled_amount   DECIMAL(10,2) NULL,
  donor_member_id    INT NULL,
  donor_sponsor_id   INT NULL,
  donor_name         VARCHAR(200) NULL,
  fulfilled_notes    TEXT NULL,
  linked_inv_item_id INT NULL,                  -- the asset created from this wish, if any
  requested_by_id    INT NULL,
  created_by_id      INT NULL,
  created_at         DATETIME NULL,
  updated_at         DATETIME NULL,
  KEY idx_wl_scope (scope, team_season_id),
  KEY idx_wl_status (status),
  CONSTRAINT fk_wl_team          FOREIGN KEY (team_season_id)     REFERENCES team_seasons(id) ON DELETE CASCADE,
  CONSTRAINT fk_wl_donor_member  FOREIGN KEY (donor_member_id)    REFERENCES members(id)      ON DELETE SET NULL,
  CONSTRAINT fk_wl_donor_sponsor FOREIGN KEY (donor_sponsor_id)   REFERENCES sponsors(id)     ON DELETE SET NULL,
  CONSTRAINT fk_wl_inv           FOREIGN KEY (linked_inv_item_id) REFERENCES inv_items(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES ('0096', NOW());
