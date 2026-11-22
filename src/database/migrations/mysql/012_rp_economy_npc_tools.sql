ALTER TABLE items
  ADD COLUMN npc_tool_grants_item_id       INT DEFAULT NULL,
  ADD COLUMN npc_tool_grants_rate          DOUBLE DEFAULT NULL CHECK(npc_tool_grants_rate IS NULL OR npc_tool_grants_rate > 0),
  ADD COLUMN npc_tool_produces_laburo_rate DOUBLE DEFAULT NULL CHECK(npc_tool_produces_laburo_rate IS NULL OR npc_tool_produces_laburo_rate > 0);
