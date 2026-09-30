-- Distributed inventory stock: an item's quantity is split across "holdings",
-- each either at a physical location OR with a team (never both). The item's
-- current_quantity is the sum of its holdings. This lets us see, e.g., 5 odometry
-- pods as 1 in the FTC Parts Room, 1 with team 10355, 1 with 11572, etc.
CREATE TABLE IF NOT EXISTS inv_item_holdings (
  id INT NOT NULL AUTO_INCREMENT,
  item_id INT NOT NULL,
  location_id INT DEFAULT NULL,
  team_season_id INT DEFAULT NULL,
  quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY item_id (item_id),
  KEY location_id (location_id),
  KEY team_season_id (team_season_id),
  CONSTRAINT inv_item_holdings_ibfk_1 FOREIGN KEY (item_id) REFERENCES inv_items (id) ON DELETE CASCADE,
  CONSTRAINT inv_item_holdings_ibfk_2 FOREIGN KEY (location_id) REFERENCES inv_locations (id) ON DELETE SET NULL,
  CONSTRAINT inv_item_holdings_ibfk_3 FOREIGN KEY (team_season_id) REFERENCES team_seasons (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed each item that has stock with a single holding from its existing
-- location/team assignment (team wins if both are set).
INSERT INTO inv_item_holdings (item_id, location_id, team_season_id, quantity)
SELECT id,
       CASE WHEN assigned_team_season_id IS NOT NULL THEN NULL ELSE location_id END,
       assigned_team_season_id,
       COALESCE(current_quantity, 0)
FROM inv_items
WHERE COALESCE(current_quantity, 0) <> 0;
