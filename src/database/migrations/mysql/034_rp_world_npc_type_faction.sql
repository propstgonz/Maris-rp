ALTER TABLE npc_types
  ADD COLUMN faction_id INT DEFAULT NULL;

CREATE INDEX idx_npc_types_faction ON npc_types(faction_id);
