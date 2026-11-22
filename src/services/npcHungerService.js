import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { consumeFromNpcStorage } from './npcProductionService.js';
import { spendFromStorage, hasNearbySilo } from './factionStorageService.js';

const DESERTION_DAYS = 3;

const SQL = {
  getOwnedNpcs: `
    SELECT n.id, n.consecutive_hungry_days, t.coord_x, t.coord_y, p.faction_id AS owner_faction_id
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    JOIN ${T.players} p ON n.owner_player_id = p.id
    WHERE n.owner_player_id IS NOT NULL
  `,
  findFoodInNpcStorage: `
    SELECT ns.item_id, ns.quantity
    FROM ${T.npc_storage} ns JOIN ${T.items} i ON ns.item_id = i.id
    WHERE ns.npc_id = ? AND i.is_consumable = 1 AND i.consume_hunger_delta > 0 AND ns.quantity > 0
    LIMIT 1
  `,
  findFoodInFactionStorage: `
    SELECT fs.item_id, fs.quantity
    FROM ${T.faction_storage} fs JOIN ${T.items} i ON fs.item_id = i.id
    WHERE fs.faction_id = ? AND i.is_consumable = 1 AND i.consume_hunger_delta > 0 AND fs.quantity > 0
    LIMIT 1
  `,
  incrementHunger: `UPDATE ${T.npcs} SET consecutive_hungry_days = consecutive_hungry_days + 1 WHERE id = ?`,
  resetHunger: `UPDATE ${T.npcs} SET consecutive_hungry_days = 0 WHERE id = ?`,
  desert: `
    UPDATE ${T.npcs}
    SET owner_player_id = NULL, is_wild = 1, role = NULL, equipped_tool_item_id = NULL,
        is_active_mount = 0, consecutive_hungry_days = 0
    WHERE id = ?
  `,
};

async function _processOne(npc) {
  return withTransaction(async () => {
    const ownFood = await queryOne(SQL.findFoodInNpcStorage, [npc.id]);
    if (ownFood) {
      await consumeFromNpcStorage(npc.id, ownFood.item_id, 1);
      await execute(SQL.resetHunger, [npc.id]);
      return 'fed';
    }

    if (await hasNearbySilo(npc.owner_faction_id, npc)) {
      const factionFood = await queryOne(SQL.findFoodInFactionStorage, [npc.owner_faction_id]);
      if (factionFood) {
        await spendFromStorage(npc.owner_faction_id, factionFood.item_id, 1);
        await execute(SQL.resetHunger, [npc.id]);
        return 'fed';
      }
    }

    if (npc.consecutive_hungry_days + 1 >= DESERTION_DAYS) {
      await execute(SQL.desert, [npc.id]);
      return 'deserted';
    }
    await execute(SQL.incrementHunger, [npc.id]);
    return 'hungry';
  });
}

export async function processNpcHunger() {
  const npcs = await query(SQL.getOwnedNpcs);
  const stats = { fed: 0, hungry: 0, deserted: 0 };

  for (const npc of npcs) {
    try {
      const outcome = await _processOne(npc);
      stats[outcome]++;
      if (outcome === 'deserted') {
        logger.info(`[NpcHunger] NPC #${npc.id} desertó tras ${DESERTION_DAYS} días sin comer — vuelve a ser salvaje.`);
      }
    } catch (err) {
      logger.error(`[NpcHunger] Error procesando comida de NPC #${npc.id}: ${err.message}`);
    }
  }

  return stats;
}
