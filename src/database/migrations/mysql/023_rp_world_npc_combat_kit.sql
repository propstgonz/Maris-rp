ALTER TABLE npc_types
  ADD COLUMN secondary_weapon_item_id INT DEFAULT NULL,
  ADD COLUMN heal_item_id             INT DEFAULT NULL,
  ADD COLUMN heal_threshold_percent   DOUBLE NOT NULL DEFAULT 50 CHECK(heal_threshold_percent BETWEEN 0 AND 100),
  ADD COLUMN mount_item_id            INT DEFAULT NULL;
