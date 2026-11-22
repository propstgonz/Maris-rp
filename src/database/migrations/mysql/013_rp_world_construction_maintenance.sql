ALTER TABLE construction_types
  ADD COLUMN maintenance_item_id INT DEFAULT NULL,
  ADD COLUMN maintenance_rate    DOUBLE DEFAULT NULL CHECK(maintenance_rate IS NULL OR maintenance_rate > 0);

ALTER TABLE constructions
  ADD COLUMN consecutive_unmaintained_days INT NOT NULL DEFAULT 0;
