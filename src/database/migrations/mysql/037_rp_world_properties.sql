INSERT INTO rp_players.player_npcs (owner_player_id, name, created_at)
SELECT n.owner_player_id, LEFT(t.display_name, 80), n.created_at
FROM npcs n
JOIN npc_types t ON t.id = n.npc_type_id
JOIN rp_players.players p ON p.id = n.owner_player_id
WHERE n.owner_player_id IS NOT NULL
ORDER BY n.id;

INSERT INTO rp_economy.inventory (player_id, item_id, quantity)
SELECT s.player_id, s.item_id, SUM(s.quantity)
FROM (
    SELECT c.built_by_player_id AS player_id, cs.item_id AS item_id, cs.quantity AS quantity
    FROM construction_storage cs
    JOIN constructions c ON c.id = cs.construction_id
    WHERE c.built_by_player_id IS NOT NULL
    UNION ALL
    SELECT n.owner_player_id, ns.item_id, ns.quantity
    FROM npc_storage ns
    JOIN npcs n ON n.id = ns.npc_id
    WHERE n.owner_player_id IS NOT NULL
    UNION ALL
    SELECT n.owner_player_id, ni.item_id, ni.quantity
    FROM npc_inventory ni
    JOIN npcs n ON n.id = ni.npc_id
    WHERE n.owner_player_id IS NOT NULL
    UNION ALL
    SELECT f.owner_player_id, fs.item_id, fs.quantity
    FROM rp_players.faction_storage fs
    JOIN rp_players.factions f ON f.id = fs.faction_id
    WHERE f.owner_player_id IS NOT NULL
) s
JOIN rp_players.players p ON p.id = s.player_id
JOIN rp_economy.items i ON i.id = s.item_id
GROUP BY s.player_id, s.item_id
HAVING SUM(s.quantity) > 0
ON DUPLICATE KEY UPDATE quantity = rp_economy.inventory.quantity + VALUES(quantity);

DELETE FROM constructions WHERE built_by_player_id IS NULL OR construction_type_id IS NULL;

SET @sql = (SELECT CONCAT('ALTER TABLE constructions DROP FOREIGN KEY `', CONSTRAINT_NAME, '`') FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'constructions' AND COLUMN_NAME = 'tile_id' AND REFERENCED_TABLE_NAME = 'map_tiles' LIMIT 1);
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT CONCAT('ALTER TABLE npcs DROP FOREIGN KEY `', CONSTRAINT_NAME, '`') FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'npcs' AND COLUMN_NAME = 'tile_id' AND REFERENCED_TABLE_NAME = 'map_tiles' LIMIT 1);
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (SELECT CONCAT('ALTER TABLE constructions DROP FOREIGN KEY `', CONSTRAINT_NAME, '`') FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'constructions' AND COLUMN_NAME = 'construction_type_id' AND REFERENCED_TABLE_NAME = 'construction_types' LIMIT 1);
SET @sql = IFNULL(@sql, 'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

RENAME TABLE construction_types TO property_types, constructions TO properties;

ALTER TABLE properties
    CHANGE COLUMN built_by_player_id owner_player_id INT NOT NULL,
    CHANGE COLUMN construction_type_id property_type_id INT NOT NULL,
    MODIFY name VARCHAR(191) DEFAULT NULL,
    ADD COLUMN level SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN location VARCHAR(100) DEFAULT NULL;

ALTER TABLE properties
    ADD CONSTRAINT chk_properties_level CHECK (level >= 1),
    ADD CONSTRAINT fk_properties_type FOREIGN KEY (property_type_id) REFERENCES property_types(id),
    ADD KEY idx_owner (owner_player_id);

ALTER TABLE property_types
    ADD COLUMN category VARCHAR(16) NOT NULL DEFAULT 'vivienda',
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1,
    ADD CONSTRAINT chk_property_types_category CHECK (category IN ('vivienda','ganaderia','infraestructura','ocio','produccion','extraccion','religion','educacion','naval','terreno'));
