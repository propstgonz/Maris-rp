ALTER TABLE construction_types
  ADD COLUMN storage_capacity DOUBLE DEFAULT NULL CHECK (storage_capacity IS NULL OR storage_capacity > 0),
  ADD COLUMN production_interval_hours INT NOT NULL DEFAULT 24 CHECK (production_interval_hours > 0),
  ADD COLUMN max_accrual_hours INT NOT NULL DEFAULT 48 CHECK (max_accrual_hours > 0);

ALTER TABLE constructions
  ADD COLUMN last_production_at DATETIME DEFAULT NULL;

CREATE TABLE construction_storage (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    construction_id INT NOT NULL,
    item_id         INT NOT NULL,
    quantity        DOUBLE NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    FOREIGN KEY (construction_id) REFERENCES constructions(id) ON DELETE CASCADE,
    UNIQUE KEY idx_construction_storage_item (construction_id, item_id)
);
