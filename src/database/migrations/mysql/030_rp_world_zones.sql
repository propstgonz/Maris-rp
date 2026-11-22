CREATE TABLE zones (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    name         VARCHAR(191) NOT NULL UNIQUE,
    display_name VARCHAR(191) NOT NULL,
    emoji        VARCHAR(32) DEFAULT '🧭',
    color        VARCHAR(16) NOT NULL DEFAULT '#888888',
    description  TEXT DEFAULT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE zone_resources (
    id                  INT PRIMARY KEY AUTO_INCREMENT,
    zone_id             INT NOT NULL,
    item_id             INT NOT NULL,
    quantity            INT NOT NULL CHECK(quantity > 0),
    drop_chance_percent DOUBLE NOT NULL CHECK(drop_chance_percent > 0 AND drop_chance_percent <= 100),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(zone_id, item_id),
    FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

CREATE TABLE npc_type_zones (
    id                            INT PRIMARY KEY AUTO_INCREMENT,
    npc_type_id                   INT NOT NULL,
    zone_id                       INT NOT NULL,
    spawn_chance_override_percent DOUBLE DEFAULT NULL,
    UNIQUE(npc_type_id, zone_id),
    FOREIGN KEY (npc_type_id) REFERENCES npc_types(id) ON DELETE CASCADE,
    FOREIGN KEY (zone_id)     REFERENCES zones(id)     ON DELETE CASCADE
);

CREATE TABLE npc_group_type_zones (
    id                            INT PRIMARY KEY AUTO_INCREMENT,
    group_type_id                 INT NOT NULL,
    zone_id                       INT NOT NULL,
    spawn_chance_override_percent DOUBLE DEFAULT NULL,
    UNIQUE(group_type_id, zone_id),
    FOREIGN KEY (group_type_id) REFERENCES npc_group_types(id) ON DELETE CASCADE,
    FOREIGN KEY (zone_id)       REFERENCES zones(id)           ON DELETE CASCADE
);

ALTER TABLE map_tiles
  ADD COLUMN zone_id INT DEFAULT NULL,
  ADD FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL;

CREATE INDEX idx_map_tiles_zone ON map_tiles(zone_id);
