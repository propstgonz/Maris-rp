import { query, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { isConstructionRuined } from '../utils/sql.js';
import { getStorageContents, consumeFromStorage } from './storageService.js';
import { getStorageContentsMap, spendFromStorage as spendFromFactionStorage, hasNearbySilo } from './factionStorageService.js';
import { damageConstruction } from './mapService.js';

const DAMAGE_START_DAY = 3;
const DAMAGE_PER_DAY = 1;

const SQL = {
  getMaintainedConstructions: `
    SELECT c.id, c.name, c.current_health, c.consecutive_unmaintained_days,
           ct.max_health AS ct_max_health, ct.maintenance_item_id, ct.maintenance_rate,
           t.coord_x, t.coord_y,
           p.faction_id AS owner_faction_id
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.players} p ON c.built_by_player_id = p.id
    WHERE ct.maintenance_item_id IS NOT NULL AND ct.maintenance_rate IS NOT NULL
  `,
  resetMaintenance: `UPDATE ${T.constructions} SET consecutive_unmaintained_days = 0 WHERE id = ?`,
  incrementMaintenance: `UPDATE ${T.constructions} SET consecutive_unmaintained_days = consecutive_unmaintained_days + 1 WHERE id = ?`,
};

async function _processOne(c) {
  return withTransaction(async () => {
    const ownContents = await getStorageContents(c.id);
    const ownRow = ownContents.find(row => row.item_id === c.maintenance_item_id);
    if ((ownRow?.quantity ?? 0) >= c.maintenance_rate) {
      await consumeFromStorage(c.id, c.maintenance_item_id, c.maintenance_rate);
      await execute(SQL.resetMaintenance, [c.id]);
      return 'maintained';
    }

    if (await hasNearbySilo(c.owner_faction_id, c)) {
      const factionContents = await getStorageContentsMap(c.owner_faction_id);
      if ((factionContents.get(c.maintenance_item_id) ?? 0) >= c.maintenance_rate) {
        await spendFromFactionStorage(c.owner_faction_id, c.maintenance_item_id, c.maintenance_rate);
        await execute(SQL.resetMaintenance, [c.id]);
        return 'maintained';
      }
    }

    const newDays = c.consecutive_unmaintained_days + 1;
    await execute(SQL.incrementMaintenance, [c.id]);

    if (newDays >= DAMAGE_START_DAY) {
      const { ruinedNow } = await damageConstruction(c.id, DAMAGE_PER_DAY);
      return ruinedNow ? 'ruined' : 'damaged';
    }
    return 'unmaintained';
  });
}

export async function processConstructionMaintenance() {
  const all = await query(SQL.getMaintainedConstructions);
  const constructions = all.filter(c => !isConstructionRuined({ current_health: c.current_health, ct_max_health: c.ct_max_health }));
  const stats = { maintained: 0, unmaintained: 0, damaged: 0, ruined: 0 };

  for (const c of constructions) {
    try {
      const outcome = await _processOne(c);
      stats[outcome]++;
      if (outcome === 'ruined') {
        logger.info(`[ConstructionMaintenance] "${c.name}" (${c.coord_x},${c.coord_y}) quedó en ruinas por falta de mantenimiento.`);
      }
    } catch (err) {
      logger.error(`[ConstructionMaintenance] Error procesando mantenimiento de construcción #${c.id}: ${err.message}`);
    }
  }

  return stats;
}
