-- #47 Inventory location detail: rack/shelf/bin per (item × location).
-- A part stored in two areas (e.g. FTC Parts Room and FRC Parts Area) has its
-- own rack/shelf/bin in each, so the spot attaches to the item+location pair —
-- not to the item alone and not per-unit. Works for both quantity parts and
-- single assets (anything that has a location).
CREATE TABLE IF NOT EXISTS inv_item_locations (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    item_id      INT NOT NULL,
    location_id  INT NOT NULL,
    rack         VARCHAR(40) NULL,
    shelf        VARCHAR(40) NULL,
    bin          VARCHAR(40) NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_item_location (item_id, location_id),
    KEY idx_location (location_id),
    CONSTRAINT fk_iil_item FOREIGN KEY (item_id) REFERENCES inv_items (id) ON DELETE CASCADE,
    CONSTRAINT fk_iil_location FOREIGN KEY (location_id) REFERENCES inv_locations (id) ON DELETE CASCADE
);
