ALTER TABLE npc_types
  ADD COLUMN theft_chance_percent     DOUBLE NOT NULL DEFAULT 50  CHECK(theft_chance_percent BETWEEN 0 AND 100),
  ADD COLUMN trade_margin_percent     DOUBLE NOT NULL DEFAULT 100 CHECK(trade_margin_percent >= 0),
  ADD COLUMN surrender_chance_percent DOUBLE NOT NULL DEFAULT 50  CHECK(surrender_chance_percent BETWEEN 0 AND 100);

ALTER TABLE npc_group_types
  ADD COLUMN surrender_chance_percent DOUBLE NOT NULL DEFAULT 50 CHECK(surrender_chance_percent BETWEEN 0 AND 100);

CREATE TABLE npc_inventory (
    id       INT PRIMARY KEY AUTO_INCREMENT,
    npc_id   INT NOT NULL,
    item_id  INT NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    UNIQUE(npc_id, item_id),
    FOREIGN KEY (npc_id) REFERENCES npcs(id) ON DELETE CASCADE
);

CREATE INDEX idx_npc_inventory_npc ON npc_inventory(npc_id);
