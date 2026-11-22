ALTER TABLE construction_types
  ADD COLUMN is_recruitment_office TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_recruitment_office IN (0, 1)),
  ADD COLUMN is_resource_silo      TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_resource_silo IN (0, 1));

ALTER TABLE npc_types
  ADD COLUMN is_recruitable            TINYINT(1) NOT NULL DEFAULT 0 CHECK(is_recruitable IN (0, 1)),
  ADD COLUMN can_produce               TINYINT(1) NOT NULL DEFAULT 1 CHECK(can_produce IN (0, 1)),
  ADD COLUMN can_soldier               TINYINT(1) NOT NULL DEFAULT 0 CHECK(can_soldier IN (0, 1)),
  ADD COLUMN production_interval_hours INT NOT NULL DEFAULT 24 CHECK(production_interval_hours > 0),
  ADD COLUMN max_accrual_hours         INT NOT NULL DEFAULT 48 CHECK(max_accrual_hours > 0);

ALTER TABLE npcs
  ADD COLUMN owner_player_id        INT DEFAULT NULL,
  ADD COLUMN last_production_at     DATETIME DEFAULT NULL,
  ADD COLUMN role                   VARCHAR(16) DEFAULT NULL CHECK(role IN ('producer', 'soldier') OR role IS NULL),
  ADD COLUMN equipped_tool_item_id  INT DEFAULT NULL,
  ADD COLUMN consecutive_hungry_days INT NOT NULL DEFAULT 0;

CREATE INDEX idx_npcs_owner ON npcs(owner_player_id);

CREATE TABLE npc_type_equipment (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    npc_type_id INT NOT NULL,
    item_id     INT NOT NULL,
    quantity    DOUBLE NOT NULL CHECK(quantity > 0),
    FOREIGN KEY (npc_type_id) REFERENCES npc_types(id) ON DELETE CASCADE
);
CREATE INDEX idx_npc_type_equipment_type ON npc_type_equipment(npc_type_id);

CREATE TABLE npc_storage (
    id       INT PRIMARY KEY AUTO_INCREMENT,
    npc_id   INT NOT NULL,
    item_id  INT NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE,
    UNIQUE KEY idx_npc_storage_item (npc_id, item_id)
);
