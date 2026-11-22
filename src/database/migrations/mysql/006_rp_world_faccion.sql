ALTER TABLE map_tiles CHANGE COLUMN nation_id faction_id INT DEFAULT NULL;
ALTER TABLE map_tiles RENAME INDEX idx_map_tiles_nation TO idx_map_tiles_faction;

SET @cn = (SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'rp_world' AND CHECK_CLAUSE LIKE '%`destroy_policy`%' LIMIT 1);
SET @sql = CONCAT('ALTER TABLE construction_types DROP CHECK `', @cn, '`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cn = (SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'rp_world' AND CHECK_CLAUSE LIKE '%`use_policy`%' LIMIT 1);
SET @sql = CONCAT('ALTER TABLE construction_types DROP CHECK `', @cn, '`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cn = (SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'rp_world' AND CHECK_CLAUSE LIKE '%`refuel_policy`%' LIMIT 1);
SET @sql = CONCAT('ALTER TABLE construction_types DROP CHECK `', @cn, '`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cn = (SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'rp_world' AND CHECK_CLAUSE LIKE '%`repair_policy`%' LIMIT 1);
SET @sql = CONCAT('ALTER TABLE construction_types DROP CHECK `', @cn, '`');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE construction_types SET destroy_policy = 'faccion' WHERE destroy_policy = 'nation';
UPDATE construction_types SET destroy_policy = 'rolepriest' WHERE destroy_policy = 'staff';
UPDATE construction_types SET use_policy = 'faccion' WHERE use_policy = 'nation';
UPDATE construction_types SET use_policy = 'rolepriest' WHERE use_policy = 'staff';
UPDATE construction_types SET refuel_policy = 'faccion' WHERE refuel_policy = 'nation';
UPDATE construction_types SET refuel_policy = 'rolepriest' WHERE refuel_policy = 'staff';
UPDATE construction_types SET repair_policy = 'faccion' WHERE repair_policy = 'nation';
UPDATE construction_types SET repair_policy = 'rolepriest' WHERE repair_policy = 'staff';

ALTER TABLE construction_types ADD CONSTRAINT chk_construction_types_destroy_policy CHECK (destroy_policy IN ('any','owner','faccion','rolepriest'));
ALTER TABLE construction_types ADD CONSTRAINT chk_construction_types_use_policy CHECK (use_policy IN ('any','owner','faccion','rolepriest'));
ALTER TABLE construction_types ADD CONSTRAINT chk_construction_types_refuel_policy CHECK (refuel_policy IN ('any','owner','faccion','rolepriest'));
ALTER TABLE construction_types ADD CONSTRAINT chk_construction_types_repair_policy CHECK (repair_policy IN ('any','owner','faccion','rolepriest'));
