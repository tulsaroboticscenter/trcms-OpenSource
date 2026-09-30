-- Room & resource reservations.
CREATE TABLE reservation_resources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  kind ENUM('room','equipment') NOT NULL DEFAULT 'room',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  notes VARCHAR(300) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  resource_id INT NOT NULL,
  member_id INT NOT NULL,
  purpose ENUM('personal','trc','team') NOT NULL DEFAULT 'personal',
  team_season_id INT NULL,
  usage_details TEXT NULL,
  special_considerations TEXT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  status ENUM('pending','approved','denied','cancelled') NOT NULL DEFAULT 'pending',
  reviewed_by_id INT NULL,
  reviewed_at DATETIME NULL,
  review_note VARCHAR(300) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_resv_resource FOREIGN KEY (resource_id) REFERENCES reservation_resources(id) ON DELETE CASCADE,
  INDEX idx_resv_range (resource_id, start_at, end_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO reservation_resources (name, kind, display_order) VALUES
 ('Computer Lab', 'room', 1),
 ('Collab Lab 1', 'room', 2),
 ('Collab Lab 2', 'room', 3),
 ('3D Printer - Flash Forge 1', 'equipment', 10),
 ('3D Printer - Flash Forge 2', 'equipment', 11),
 ('3D Printer - Flash Forge 3', 'equipment', 12),
 ('3D Printer - Soval', 'equipment', 13),
 ('CNC Machine', 'equipment', 20),
 ('Lathe', 'equipment', 21);
