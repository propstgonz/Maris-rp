ALTER TABLE npc_types
  ADD COLUMN is_tameable            TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_tameable IN (0, 1)),
  ADD COLUMN tame_chance_percent    DOUBLE NOT NULL DEFAULT 50 CHECK(tame_chance_percent BETWEEN 0 AND 100),
  ADD COLUMN tame_bait_item_id      INT DEFAULT NULL,
  ADD COLUMN vehicle_category       VARCHAR(16) DEFAULT NULL CHECK(vehicle_category IN ('aereo', 'maritimo', 'terrestre') OR vehicle_category IS NULL),
  ADD COLUMN vehicle_speed_multiplier DOUBLE NOT NULL DEFAULT 1.0 CHECK(vehicle_speed_multiplier > 0),
  ADD COLUMN breed_chance_percent   DOUBLE NOT NULL DEFAULT 50 CHECK(breed_chance_percent BETWEEN 0 AND 100);

ALTER TABLE npcs
  ADD COLUMN is_active_mount TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_active_mount IN (0, 1)),
  ADD COLUMN last_bred_at    DATETIME DEFAULT NULL;

CREATE INDEX idx_npcs_active_mount ON npcs(owner_player_id, is_active_mount);
