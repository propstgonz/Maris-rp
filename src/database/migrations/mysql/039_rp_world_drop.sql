SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS
    terrain_types, terrain_type_resources, zones, zone_resources, tile_resource_cooldowns, map_tiles,
    tile_resource_generators, tile_items, construction_type_ingredients, construction_cooldowns,
    construction_storage, npc_types, npc_type_terrains, npc_type_drops, npc_type_equipment, npc_storage,
    npc_group_types, npc_group_type_members, npc_group_type_terrains, npc_type_zones, npc_group_type_zones,
    npcs, npc_inventory, points_of_interest;

SET FOREIGN_KEY_CHECKS = 1;

SET SESSION group_concat_max_len = 1000000;
SET @drop_cols = (SELECT GROUP_CONCAT(COLUMN_NAME SEPARATOR '|') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME NOT IN ('id', 'owner_player_id', 'property_type_id', 'name', 'level', 'location', 'created_at'));
SET @sql = (SELECT CONCAT('ALTER TABLE properties ', GROUP_CONCAT(CONCAT('DROP CHECK `', c.CONSTRAINT_NAME, '`') SEPARATOR ', ')) FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'properties' AND t.CONSTRAINT_TYPE = 'CHECK' AND c.CHECK_CLAUSE REGEXP CONCAT('`(', @drop_cols, ')`'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql = (SELECT CONCAT('ALTER TABLE properties ', GROUP_CONCAT(CONCAT('DROP COLUMN `', COLUMN_NAME, '`') SEPARATOR ', ')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'properties' AND COLUMN_NAME NOT IN ('id', 'owner_player_id', 'property_type_id', 'name', 'level', 'location', 'created_at'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET SESSION group_concat_max_len = 1000000;
SET @drop_cols = (SELECT GROUP_CONCAT(COLUMN_NAME SEPARATOR '|') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'property_types' AND COLUMN_NAME NOT IN ('id', 'name', 'display_name', 'category', 'description', 'emoji', 'is_active', 'created_at'));
SET @sql = (SELECT CONCAT('ALTER TABLE property_types ', GROUP_CONCAT(CONCAT('DROP CHECK `', c.CONSTRAINT_NAME, '`') SEPARATOR ', ')) FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA = c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME = c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'property_types' AND t.CONSTRAINT_TYPE = 'CHECK' AND c.CHECK_CLAUSE REGEXP CONCAT('`(', @drop_cols, ')`'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
SET @sql = (SELECT CONCAT('ALTER TABLE property_types ', GROUP_CONCAT(CONCAT('DROP COLUMN `', COLUMN_NAME, '`') SEPARATOR ', ')) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'property_types' AND COLUMN_NAME NOT IN ('id', 'name', 'display_name', 'category', 'description', 'emoji', 'is_active', 'created_at'));
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
