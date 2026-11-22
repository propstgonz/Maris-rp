CREATE TABLE npc_group_type_terrains (
    id                             INT PRIMARY KEY AUTO_INCREMENT,
    group_type_id                  INT NOT NULL,
    terrain_type_id                INT NOT NULL,
    spawn_chance_override_percent  DOUBLE DEFAULT NULL,
    UNIQUE(group_type_id, terrain_type_id),
    FOREIGN KEY (group_type_id) REFERENCES npc_group_types(id) ON DELETE CASCADE,
    FOREIGN KEY (terrain_type_id) REFERENCES terrain_types(id) ON DELETE CASCADE
);
