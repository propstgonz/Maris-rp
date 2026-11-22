CREATE TABLE terrain_type_resources (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    terrain_type_id     INT NOT NULL,
    item_id             INT NOT NULL,
    quantity            INT NOT NULL CHECK(quantity > 0),
    drop_chance_percent DOUBLE NOT NULL CHECK(drop_chance_percent > 0 AND drop_chance_percent <= 100),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(terrain_type_id, item_id),
    FOREIGN KEY (terrain_type_id) REFERENCES terrain_types(id) ON DELETE CASCADE
);

CREATE TABLE tile_resource_cooldowns (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    tile_id      INT NOT NULL,
    player_id    INT NOT NULL,
    last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tile_id, player_id),
    FOREIGN KEY (tile_id) REFERENCES map_tiles(id) ON DELETE CASCADE
);
