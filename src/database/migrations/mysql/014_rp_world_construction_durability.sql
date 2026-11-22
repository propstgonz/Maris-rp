ALTER TABLE construction_types
  ADD COLUMN max_durability INT NOT NULL DEFAULT 100 CHECK(max_durability BETWEEN 1 AND 1000),
  ADD COLUMN durability_loss_per_day DOUBLE DEFAULT NULL CHECK(durability_loss_per_day IS NULL OR durability_loss_per_day > 0),
  ADD COLUMN durability_repair_tool_item_name VARCHAR(191) DEFAULT NULL;

ALTER TABLE constructions
  ADD COLUMN durability DOUBLE DEFAULT NULL;
