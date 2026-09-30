-- Additional descriptive spec fields for inventory items (#57): color, length,
-- pitch (for belts), pattern, inner/outer diameter, and a measurement-system
-- selector (metric / imperial / n/a). Kept as short text so they can hold values
-- with or without units (e.g. "120", "120mm", "1/2in", "GT2"); the measurement
-- system flags how to read the numeric dimensions.
ALTER TABLE inv_items
  ADD COLUMN color VARCHAR(60) DEFAULT NULL,
  ADD COLUMN length VARCHAR(40) DEFAULT NULL,
  ADD COLUMN pitch VARCHAR(40) DEFAULT NULL,
  ADD COLUMN pattern VARCHAR(60) DEFAULT NULL,
  ADD COLUMN inner_diameter VARCHAR(40) DEFAULT NULL,
  ADD COLUMN outer_diameter VARCHAR(40) DEFAULT NULL,
  ADD COLUMN measurement_system VARCHAR(10) NOT NULL DEFAULT 'na';
