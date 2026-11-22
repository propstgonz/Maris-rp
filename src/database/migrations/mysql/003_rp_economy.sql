CREATE TABLE items (
    id                       INT PRIMARY KEY AUTO_INCREMENT,
    name                     VARCHAR(191) NOT NULL UNIQUE,
    display_name             VARCHAR(191) NOT NULL,
    item_type                VARCHAR(16) NOT NULL CHECK(item_type IN (
                                 'dinero', 'consumible', 'recurso', 'herramienta', 'laburo', 'arma', 'vehiculo'
                             )),
    description              TEXT DEFAULT NULL,
    consume_hp_delta         DOUBLE DEFAULT 0,
    consume_hunger_delta     DOUBLE DEFAULT 0,
    consume_effect           VARCHAR(191) DEFAULT NULL,
    consume_effect_duration_hours INT DEFAULT NULL,
    is_consumable            TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_consumable IN (0, 1)),
    is_fuel                  TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_fuel IN (0, 1)),
    emoji                    VARCHAR(32) DEFAULT '📦',
    image_filename            VARCHAR(255) DEFAULT NULL,
    weapon_damage             DOUBLE DEFAULT NULL,
    weapon_structure_damage    DOUBLE DEFAULT NULL,
    weapon_roll_1             INT DEFAULT NULL,
    weapon_roll_2             INT DEFAULT NULL,
    weapon_roll_3             INT DEFAULT NULL,
    weapon_roll_4             INT DEFAULT NULL,
    weapon_roll_5             INT DEFAULT NULL,
    weapon_roll_6             INT DEFAULT NULL,
    weapon_max_durability     INT DEFAULT NULL,
    weapon_ammo_item_name      VARCHAR(191) DEFAULT NULL,
    weapon_ammo_cost           INT DEFAULT NULL,
    weapon_area_damage         TINYINT(1) NOT NULL DEFAULT 0 CHECK(weapon_area_damage IN (0, 1)),
    weapon_area_effect          VARCHAR(191) DEFAULT NULL,
    weapon_area_effect_duration_hours INT DEFAULT NULL,
    triggers_newspaper_channel TINYINT(1) NOT NULL DEFAULT 0 CHECK(triggers_newspaper_channel IN (0, 1)),
    vehicle_category         VARCHAR(16) DEFAULT NULL CHECK(
                                 vehicle_category IN ('aereo', 'maritimo', 'terrestre')
                                 OR vehicle_category IS NULL
                             ),
    vehicle_speed_multiplier DOUBLE NOT NULL DEFAULT 1.0 CHECK(vehicle_speed_multiplier > 0),
    weight                    DOUBLE NOT NULL DEFAULT 1 CHECK(weight >= 0),
    created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_items_weapon_ammo ON items(weapon_ammo_item_name);

CREATE TABLE effect_types (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    name                VARCHAR(191) NOT NULL UNIQUE,
    emoji               VARCHAR(32) DEFAULT '🎭',
    label               VARCHAR(191) NOT NULL,
    laburo_modifier     DOUBLE NOT NULL DEFAULT 0.0,
    hp_delta_per_day    DOUBLE NOT NULL DEFAULT 0.0,
    blocks_laburo       TINYINT(1) NOT NULL DEFAULT 0 CHECK(blocks_laburo IN (0, 1)),
    prevents_combat     TINYINT(1) NOT NULL DEFAULT 0 CHECK(prevents_combat IN (0, 1)),
    description         TEXT DEFAULT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO effect_types (name, emoji, label, laburo_modifier, hp_delta_per_day, blocks_laburo) VALUES
    ('enfermo',     '🤢', 'Enfermo',      -0.5, -1,   0),
    ('herido',      '🩹', 'Herido',       -0.3, -1,   0),
    ('fatigado',    '😴', 'Fatigado',     -0.5,  0,   0),
    ('energizado',  '⚡', 'Energizado',    1,    0.5, 0),
    ('encarcelado', '⛓️', 'Encarcelado',   0,    0,   1);

CREATE TABLE recipes (
    id                          INT PRIMARY KEY AUTO_INCREMENT,
    result_item_id              INT NOT NULL,
    result_quantity             DOUBLE NOT NULL DEFAULT 1 CHECK(result_quantity > 0),
    laburo_cost                 DOUBLE NOT NULL DEFAULT 0 CHECK(laburo_cost >= 0),
    required_construction_type  VARCHAR(191) DEFAULT NULL,
    tool_item_id                INT DEFAULT NULL,
    tool_laburo_reduction       DOUBLE DEFAULT NULL,
    FOREIGN KEY (result_item_id) REFERENCES items(id),
    FOREIGN KEY (tool_item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE TABLE recipe_ingredients (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    recipe_id            INT NOT NULL,
    ingredient_item_id   INT NOT NULL,
    quantity_required    DOUBLE NOT NULL CHECK(quantity_required > 0),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_item_id) REFERENCES items(id)
);

CREATE INDEX idx_recipe_ingredients ON recipe_ingredients(recipe_id);
CREATE INDEX idx_recipes_result_item ON recipes(result_item_id);

CREATE TABLE inventory (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    player_id   INT NOT NULL,
    item_id     INT NOT NULL,
    quantity    DOUBLE NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    durability  DOUBLE DEFAULT NULL,
    slot_position INT DEFAULT NULL,
    UNIQUE(player_id, item_id),
    FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX idx_inventory_player ON inventory(player_id);
CREATE INDEX idx_inventory_item ON inventory(item_id);

CREATE TABLE transactions (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    from_player_id  INT NOT NULL,
    to_player_id    INT NOT NULL,
    item_id         INT DEFAULT NULL,
    quantity        DOUBLE NOT NULL CHECK(quantity > 0),
    coord_x         INT NOT NULL,
    coord_y         INT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE INDEX idx_transactions_from ON transactions(from_player_id);
CREATE INDEX idx_transactions_to ON transactions(to_player_id);

CREATE TABLE pending_trades (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    from_player_id    INT NOT NULL,
    to_player_id      INT NOT NULL,
    item_id           INT NOT NULL,
    quantity          DOUBLE NOT NULL CHECK(quantity > 0),
    status            VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'expired')),
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at       DATETIME DEFAULT NULL,
    FOREIGN KEY (item_id) REFERENCES items(id)
);

CREATE INDEX idx_pending_trades_status ON pending_trades(status);

CREATE TABLE construction_market_listings (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    construction_id  INT NOT NULL,
    item_id          INT NOT NULL,
    price_laburo     DOUBLE NOT NULL CHECK(price_laburo > 0),
    stock_quantity   DOUBLE NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
    UNIQUE(construction_id, item_id),
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX idx_market_listings_construction ON construction_market_listings(construction_id);
