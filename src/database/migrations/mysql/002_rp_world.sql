CREATE TABLE terrain_types (
    id                          INT PRIMARY KEY AUTO_INCREMENT,
    name                        VARCHAR(191) NOT NULL UNIQUE,
    display_name                VARCHAR(191) NOT NULL,
    emoji                       VARCHAR(32) DEFAULT '🗺️',
    color                       VARCHAR(16) NOT NULL DEFAULT '#888888',
    requires_vehicle_category   VARCHAR(16) DEFAULT NULL CHECK(
                                    requires_vehicle_category IN ('aereo', 'maritimo', 'terrestre')
                                    OR requires_vehicle_category IS NULL
                                ),
    movement_cost               DOUBLE NOT NULL DEFAULT 1 CHECK(movement_cost > 0),
    description                 TEXT DEFAULT NULL,
    created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO terrain_types (name, display_name, emoji, color, requires_vehicle_category) VALUES
    ('mina',          'Mina',          '⛏️', '#95A5A6', NULL),
    ('granja',        'Granja',        '🌾', '#2ECC71', NULL),
    ('ciudad',        'Ciudad',        '🏙️', '#3498DB', NULL),
    ('yermo',         'Yermo',         '🏜️', '#C9A66B', NULL),
    ('bosque',        'Bosque',        '🌲', '#2ECC71', NULL),
    ('costa',         'Costa',         '🌊', '#5DADE2', NULL),
    ('mar',           'Mar',           '🌊', '#1B6FA8', 'maritimo'),
    ('mar_profundo',  'Mar Profundo',  '🌑', '#0B3D5C', 'maritimo'),
    ('isla',          'Isla',          '🏝️', '#E4C687', NULL),
    ('montana',       'Montaña',       '⛰️', '#6B5849', 'terrestre');

CREATE TABLE map_tiles (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    coord_x         INT NOT NULL,
    coord_y         INT NOT NULL,
    name            VARCHAR(191) NOT NULL DEFAULT 'Territorio sin nombre',
    terrain_type_id INT NOT NULL,
    owner_player_id INT DEFAULT NULL,
    description     TEXT DEFAULT NULL,
    resource_type   VARCHAR(191) DEFAULT NULL,
    nation_id       INT DEFAULT NULL,
    effect_type     VARCHAR(191) DEFAULT NULL,
    UNIQUE(coord_x, coord_y),
    FOREIGN KEY (terrain_type_id) REFERENCES terrain_types(id)
);

CREATE INDEX idx_tiles_coords ON map_tiles(coord_x, coord_y);
CREATE INDEX idx_map_tiles_nation ON map_tiles(nation_id);
CREATE INDEX idx_map_tiles_terrain_type ON map_tiles(terrain_type_id);

CREATE TABLE tile_resource_generators (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    tile_id         INT NOT NULL,
    item_id         INT NOT NULL,
    generation_rate DOUBLE NOT NULL DEFAULT 0 CHECK(generation_rate >= 0),
    UNIQUE(tile_id, item_id),
    FOREIGN KEY (tile_id) REFERENCES map_tiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_generators_tile ON tile_resource_generators(tile_id);

CREATE TABLE construction_types (
    id                       INT PRIMARY KEY AUTO_INCREMENT,
    name                     VARCHAR(191) NOT NULL UNIQUE,
    display_name             VARCHAR(191) NOT NULL,
    emoji                    VARCHAR(32) DEFAULT '🏗️',
    image_filename            VARCHAR(255) DEFAULT NULL,
    description              TEXT DEFAULT NULL,
    laburo_cost              DOUBLE NOT NULL DEFAULT 0 CHECK(laburo_cost >= 0),
    requires_resource_type   VARCHAR(191) DEFAULT NULL,
    unlocks_recipe_id        INT DEFAULT NULL,
    grants_resource_item_id  INT DEFAULT NULL,
    grants_resource_rate     DOUBLE DEFAULT NULL,
    max_health               INT NOT NULL DEFAULT 10 CHECK(max_health BETWEEN 1 AND 1000),
    use_tool_item_name       VARCHAR(191) DEFAULT NULL,
    use_result_item_id       INT DEFAULT NULL,
    use_roll_1                INT DEFAULT NULL,
    use_roll_2                INT DEFAULT NULL,
    use_roll_3                INT DEFAULT NULL,
    use_roll_4                INT DEFAULT NULL,
    use_roll_5                INT DEFAULT NULL,
    use_roll_6                INT DEFAULT NULL,
    use_laburo_cost           DOUBLE DEFAULT NULL,
    use_cooldown_hours        INT DEFAULT NULL,
    fuel_item_id              INT DEFAULT NULL,
    fuel_consumption_rate     DOUBLE DEFAULT NULL,
    fuel_capacity             DOUBLE DEFAULT NULL,
    is_landing_site           TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_landing_site IN (0, 1)),
    is_market                 TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_market IN (0, 1)),
    travel_cost_multiplier    DOUBLE NOT NULL DEFAULT 1 CHECK(travel_cost_multiplier > 0 AND travel_cost_multiplier <= 1),
    destroy_policy            VARCHAR(16) NOT NULL DEFAULT 'any' CHECK(destroy_policy IN ('any','owner','nation','staff')),
    use_policy                VARCHAR(16) NOT NULL DEFAULT 'any' CHECK(use_policy IN ('any','owner','nation','staff')),
    refuel_policy             VARCHAR(16) NOT NULL DEFAULT 'any' CHECK(refuel_policy IN ('any','owner','nation','staff')),
    repair_policy             VARCHAR(16) NOT NULL DEFAULT 'any' CHECK(repair_policy IN ('any','owner','nation','staff')),
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE construction_type_ingredients (
    id                     INT PRIMARY KEY AUTO_INCREMENT,
    construction_type_id   INT NOT NULL,
    ingredient_item_id     INT NOT NULL,
    quantity_required      DOUBLE NOT NULL CHECK(quantity_required > 0),
    FOREIGN KEY (construction_type_id) REFERENCES construction_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_construction_type_ingredients ON construction_type_ingredients(construction_type_id);

CREATE TABLE constructions (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    tile_id             INT NOT NULL,
    name                VARCHAR(191) NOT NULL,
    construction_type   VARCHAR(32) DEFAULT NULL CHECK(construction_type IN (
                            'fabrica', 'edificio_habitable', 'fortaleza',
                            'granja_mejorada', 'mina_mejorada'
                        ) OR construction_type IS NULL),
    construction_type_id INT DEFAULT NULL,
    unlocks_recipe_id   INT DEFAULT NULL,
    resource_bonus      DOUBLE NOT NULL DEFAULT 0 CHECK(resource_bonus >= 0),
    built_by_player_id  INT DEFAULT NULL,
    current_health      INT DEFAULT NULL,
    fuel_level          DOUBLE NOT NULL DEFAULT 0 CHECK(fuel_level >= 0),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tile_id) REFERENCES map_tiles(id) ON DELETE CASCADE,
    FOREIGN KEY (construction_type_id) REFERENCES construction_types(id) ON DELETE SET NULL
);

CREATE INDEX idx_constructions_tile ON constructions(tile_id);
CREATE INDEX idx_constructions_type ON constructions(construction_type_id);

CREATE TABLE construction_cooldowns (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    construction_id INT NOT NULL,
    player_id       INT NOT NULL,
    last_used_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(construction_id, player_id),
    FOREIGN KEY (construction_id) REFERENCES constructions(id) ON DELETE CASCADE
);

CREATE TABLE npc_types (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    name                 VARCHAR(191) NOT NULL UNIQUE,
    display_name         VARCHAR(191) NOT NULL,
    emoji                VARCHAR(32) DEFAULT '👤',
    description          TEXT DEFAULT NULL,
    max_hp               INT NOT NULL DEFAULT 5 CHECK(max_hp > 0),
    weapon_item_id       INT DEFAULT NULL,
    spawn_chance_percent DOUBLE NOT NULL DEFAULT 0 CHECK(spawn_chance_percent BETWEEN 0 AND 100),
    image_filename       VARCHAR(255) DEFAULT NULL,
    is_aggressive        TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_aggressive IN (0, 1)),
    flee_chance_percent  DOUBLE NOT NULL DEFAULT 100 CHECK(flee_chance_percent BETWEEN 0 AND 100),
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE npc_type_terrains (
    id                             INT PRIMARY KEY AUTO_INCREMENT,
    npc_type_id                    INT NOT NULL,
    terrain_type_id                INT NOT NULL,
    spawn_chance_override_percent  DOUBLE DEFAULT NULL,
    UNIQUE(npc_type_id, terrain_type_id),
    FOREIGN KEY (npc_type_id) REFERENCES npc_types(id) ON DELETE CASCADE,
    FOREIGN KEY (terrain_type_id) REFERENCES terrain_types(id) ON DELETE CASCADE
);

CREATE TABLE npc_type_drops (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    npc_type_id         INT NOT NULL,
    item_id             INT NOT NULL,
    quantity            DOUBLE NOT NULL CHECK(quantity > 0),
    drop_chance_percent DOUBLE NOT NULL DEFAULT 100 CHECK(drop_chance_percent BETWEEN 0 AND 100),
    FOREIGN KEY (npc_type_id) REFERENCES npc_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_npc_type_drops_type ON npc_type_drops(npc_type_id);

CREATE TABLE npcs (
    id                              INT PRIMARY KEY AUTO_INCREMENT,
    tile_id                         INT NOT NULL,
    npc_type_id                     INT NOT NULL,
    current_hp                      INT NOT NULL,
    is_wild                         TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_wild IN (0, 1)),
    encountered_by_player_id        INT DEFAULT NULL,
    encountered_channel_id          VARCHAR(191) DEFAULT NULL,
    encountered_channel_message_id  VARCHAR(191) DEFAULT NULL,
    encountered_dm_message_id       VARCHAR(191) DEFAULT NULL,
    created_at                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tile_id) REFERENCES map_tiles(id) ON DELETE CASCADE,
    FOREIGN KEY (npc_type_id) REFERENCES npc_types(id) ON DELETE CASCADE
);

CREATE INDEX idx_npcs_tile ON npcs(tile_id);
CREATE INDEX idx_npcs_encountered_by ON npcs(encountered_by_player_id);

CREATE TABLE tile_items (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    tile_id              INT NOT NULL,
    item_id              INT NOT NULL,
    quantity             DOUBLE NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    dropped_by_player_id INT DEFAULT NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tile_id, item_id),
    FOREIGN KEY (tile_id) REFERENCES map_tiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_tile_items_tile ON tile_items(tile_id);
CREATE INDEX idx_tile_items_item ON tile_items(item_id);
