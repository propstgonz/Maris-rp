CREATE TABLE points_of_interest (
    id                    INT PRIMARY KEY AUTO_INCREMENT,
    tile_id               INT NOT NULL,
    name                  VARCHAR(191) NOT NULL,
    description           TEXT DEFAULT NULL,
    emoji                 VARCHAR(32) DEFAULT '📍',
    created_by_player_id  INT DEFAULT NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tile_id) REFERENCES map_tiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_poi_tile ON points_of_interest(tile_id);
