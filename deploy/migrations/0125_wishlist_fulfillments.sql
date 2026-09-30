-- 0125_wishlist_fulfillments.sql
-- #155: partial fulfillment of wish-list items + track who donated and whether we
-- thanked them. A wish item can now be fulfilled by several donations over time
-- (e.g. 2 of 5), each with its own donor and "thanked" state. The item's status
-- becomes fulfilled once the donated quantity reaches the requested quantity.

CREATE TABLE IF NOT EXISTS wish_list_fulfillments (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  wish_id             INT NOT NULL,
  quantity            INT NOT NULL DEFAULT 1,
  amount              DECIMAL(10,2) NULL,
  donor_member_id     INT NULL,
  donor_sponsor_id    INT NULL,
  donor_name          VARCHAR(200) NULL,
  fulfilled_date      DATE NULL,
  notes               TEXT NULL,
  thanked             TINYINT(1) NOT NULL DEFAULT 0,
  thanked_date        DATE NULL,
  thanked_by_id       INT NULL,
  linked_inv_item_id  INT NULL,
  created_by_id       INT NULL,
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  INDEX idx_wlf_wish (wish_id),
  CONSTRAINT fk_wlf_wish FOREIGN KEY (wish_id) REFERENCES wish_list_items(id) ON DELETE CASCADE
);

-- Backfill: turn each already-fulfilled item into one donation covering the whole
-- requested quantity, preserving its donor / amount / date / notes / linked asset.
INSERT INTO wish_list_fulfillments
  (wish_id, quantity, amount, donor_member_id, donor_sponsor_id, donor_name, fulfilled_date, notes, linked_inv_item_id, created_at, updated_at)
SELECT w.id, GREATEST(w.quantity, 1), w.fulfilled_amount, w.donor_member_id, w.donor_sponsor_id, w.donor_name,
       w.fulfilled_date, w.fulfilled_notes, w.linked_inv_item_id, NOW(), NOW()
  FROM wish_list_items w
 WHERE w.status = 'fulfilled';
