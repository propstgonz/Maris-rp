CREATE TABLE npc_group_types (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    name                 VARCHAR(191) NOT NULL UNIQUE,
    display_name         VARCHAR(191) NOT NULL,
    emoji                VARCHAR(32) DEFAULT '👥',
    description          TEXT DEFAULT NULL,
    spawn_chance_percent DOUBLE NOT NULL DEFAULT 0 CHECK(spawn_chance_percent BETWEEN 0 AND 100),
    is_aggressive        TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_aggressive IN (0, 1)),
    flee_chance_percent  DOUBLE NOT NULL DEFAULT 100 CHECK(flee_chance_percent BETWEEN 0 AND 100),
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE npc_group_type_members (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    group_type_id INT NOT NULL,
    npc_type_id   INT NOT NULL,
    quantity      INT NOT NULL DEFAULT 1 CHECK(quantity > 0),
    UNIQUE KEY idx_npc_group_member_unique (group_type_id, npc_type_id),
    FOREIGN KEY (group_type_id) REFERENCES npc_group_types(id) ON DELETE CASCADE,
    FOREIGN KEY (npc_type_id) REFERENCES npc_types(id)
);
CREATE INDEX idx_npc_group_members_group ON npc_group_type_members(group_type_id);

ALTER TABLE npcs
  ADD COLUMN spawned_from_group_type_id INT DEFAULT NULL,
  ADD FOREIGN KEY (spawned_from_group_type_id) REFERENCES npc_group_types(id);
CREATE INDEX idx_npcs_group_type ON npcs(spawned_from_group_type_id);
