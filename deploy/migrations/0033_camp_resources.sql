-- Summer Camp Resources (#68): links to docs/sites/social/etc. that staff
-- collect while planning a camp season, grouped into General + per-week buckets.
CREATE TABLE IF NOT EXISTS camp_resources (
  id INT NOT NULL AUTO_INCREMENT,
  season_id INT NOT NULL,
  bucket VARCHAR(20) NOT NULL DEFAULT 'general',   -- general, week1, week2, week3
  title VARCHAR(200) NOT NULL,
  url VARCHAR(1000) DEFAULT NULL,
  resource_type VARCHAR(30) DEFAULT NULL,          -- document, website, social, other
  notes TEXT DEFAULT NULL,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_camp_res_season (season_id, bucket, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
