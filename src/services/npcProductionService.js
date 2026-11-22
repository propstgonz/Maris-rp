import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { toSqlDatetime, fromSqlDatetime } from '../utils/sqlDatetime.js';
import { computeProductionCycles, cyclesAvailableFor } from './productionService.js';
import { earnLaburo } from './laburoService.js';
import { addItem } from './inventoryService.js';
import { UserFacingError } from '../utils/errors.js';

const SQL = {
  getProducer: `
    SELECT n.id, n.tile_id, n.owner_player_id, n.role, n.last_production_at, n.created_at,
           p.discord_id AS owner_discord_id,
           t.coord_x, t.coord_y,
           nt.display_name AS type_display_name,
           nt.production_interval_hours, nt.max_accrual_hours,
           ti.npc_tool_produces_laburo_rate, ti.npc_tool_grants_item_id, ti.npc_tool_grants_rate,
           gi.name AS granted_item_name, gi.display_name AS granted_item_display, gi.weight AS granted_item_weight
    FROM ${T.npcs} n
    JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    LEFT JOIN ${T.players} p ON n.owner_player_id = p.id
    LEFT JOIN ${T.items} ti ON n.equipped_tool_item_id = ti.id
    LEFT JOIN ${T.items} gi ON ti.npc_tool_grants_item_id = gi.id
    WHERE n.id = ?
  `,
  getAllProducers: `
    SELECT n.id
    FROM ${T.npcs} n
    JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
    JOIN ${T.items} ti ON n.equipped_tool_item_id = ti.id
    WHERE n.owner_player_id IS NOT NULL
      AND n.role = 'producer'
      AND (ti.npc_tool_produces_laburo_rate IS NOT NULL OR ti.npc_tool_grants_item_id IS NOT NULL)
      AND (n.last_production_at IS NULL OR n.last_production_at <= DATE_SUB(NOW(), INTERVAL nt.production_interval_hours HOUR))
  `,
  countPendingForPlayer: `
    SELECT COUNT(*) AS cnt
    FROM ${T.npcs} n
    JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
    JOIN ${T.items} ti ON n.equipped_tool_item_id = ti.id
    WHERE n.owner_player_id = ?
      AND n.role = 'producer'
      AND (ti.npc_tool_produces_laburo_rate IS NOT NULL OR ti.npc_tool_grants_item_id IS NOT NULL)
      AND (n.last_production_at IS NULL OR n.last_production_at <= DATE_SUB(NOW(), INTERVAL nt.production_interval_hours HOUR))
  `,
  setLastProduction: `UPDATE ${T.npcs} SET last_production_at = ? WHERE id = ?`,

  getLastProductionForUpdate: `SELECT last_production_at FROM ${T.npcs} WHERE id = ? FOR UPDATE`,

  getStorageContents: `
    SELECT ns.item_id, ns.quantity, i.name, i.display_name, i.emoji, i.weight
    FROM ${T.npc_storage} ns
    JOIN ${T.items} i ON ns.item_id = i.id
    WHERE ns.npc_id = ?
    ORDER BY i.display_name ASC
  `,
  getItemByName: `SELECT id, name, display_name, emoji, weight FROM ${T.items} WHERE name = ?`,
  getStorageRow: `SELECT quantity FROM ${T.npc_storage} WHERE npc_id = ? AND item_id = ?`,
  upsertStorageAdd: `
    INSERT INTO ${T.npc_storage} (npc_id, item_id, quantity)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
  `,
  setStorageQuantity: `UPDATE ${T.npc_storage} SET quantity = ? WHERE npc_id = ? AND item_id = ?`,

  subtractStorage: `UPDATE ${T.npc_storage} SET quantity = quantity - ? WHERE npc_id = ? AND item_id = ? AND quantity >= ?`,
};

async function addToNpcStorage(npcId, itemName, quantity) {
  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new Error(`No existe ningún ítem "${itemName}" en el catálogo.`);
  await execute(SQL.upsertStorageAdd, [npcId, item.id, quantity]);
}

export async function settleNpcProduction(npcId, { audit = false } = {}) {
  const n = await queryOne(SQL.getProducer, [npcId]);
  if (!n || !n.owner_discord_id || n.role !== 'producer' || (!n.npc_tool_produces_laburo_rate && !n.npc_tool_grants_item_id)) {
    return { cyclesRun: 0, produced: 0, kind: null, itemName: null };
  }

  const intervalHours = n.production_interval_hours ?? 24;
  const maxAccrualHours = n.max_accrual_hours ?? 48;
  const isLaburo = n.npc_tool_produces_laburo_rate != null;
  if (!isLaburo && n.npc_tool_grants_item_id && !n.granted_item_name) {
    logger.warn(`[NpcProduction] NPC #${npcId} "${n.type_display_name}" produce el ítem #${n.npc_tool_grants_item_id}, que ya no existe en el catálogo.`);
    throw new UserFacingError(`**${n.type_display_name}** tiene una herramienta mal configurada (el ítem que produce ya no existe). Avisa a Staff.`);
  }

  return withTransaction(async () => {
    const locked = await queryOne(SQL.getLastProductionForUpdate, [npcId]);
    if (!locked) {
      return { cyclesRun: 0, produced: 0, kind: null, itemName: null };
    }

    const since = locked.last_production_at ? fromSqlDatetime(locked.last_production_at) : fromSqlDatetime(n.created_at);
    const cyclesAvailable = cyclesAvailableFor({
      lastProductionAt: locked.last_production_at, createdAt: n.created_at, intervalHours, maxAccrualHours,
    });

    if (cyclesAvailable <= 0) {
      return { cyclesRun: 0, produced: 0, kind: isLaburo ? 'laburo' : 'resource', itemName: n.granted_item_name };
    }

    const plan = computeProductionCycles({
      cyclesAvailable,
      fuelLevel: 0, fuelConsumptionRate: 0,
      storageUsedWeight: 0, storageCapacity: null,
      itemWeight: n.granted_item_weight ?? 0,
      ratePerCycle: isLaburo ? n.npc_tool_produces_laburo_rate : n.npc_tool_grants_rate,
    });

    if (plan.cyclesRun > 0) {
      if (isLaburo) {
        await earnLaburo(n.owner_discord_id, plan.producedQuantity);
      } else {
        await addToNpcStorage(npcId, n.granted_item_name, plan.producedQuantity);
      }
      const newLastProduction = new Date(since.getTime() + plan.cyclesRun * intervalHours * 3_600_000);
      await execute(SQL.setLastProduction, [toSqlDatetime(newLastProduction), npcId]);

      if (audit) {
        logger.debug(`[NpcProduction] "${n.type_display_name}" #${npcId} produjo ${plan.producedQuantity} ${isLaburo ? 'Laburo' : n.granted_item_name} para ${n.owner_discord_id}`);
      }
    }

    return { cyclesRun: plan.cyclesRun, produced: plan.producedQuantity, kind: isLaburo ? 'laburo' : 'resource', itemName: n.granted_item_name };
  });
}

export async function flushDueNpcProduction() {
  const due = await query(SQL.getAllProducers);
  const produced = [];

  for (const { id } of due) {
    try {
      const result = await settleNpcProduction(id, { audit: true });
      if (result.cyclesRun > 0) {
        produced.push({ npcId: id, kind: result.kind, quantity: result.produced });
      }
    } catch (err) {
      logger.error(`[NpcProduction] Error liquidando producción de NPC #${id}: ${err.message}`);
    }
  }

  return { processed: due.length, produced };
}

export async function getPlayerPendingNpcProductionCount(playerId) {
  const row = await queryOne(SQL.countPendingForPlayer, [playerId]);
  return row?.cnt ?? 0;
}

export async function getNpcStorageContents(npcId) {
  return query(SQL.getStorageContents, [npcId]);
}

export async function consumeFromNpcStorage(npcId, itemId, quantity) {
  const row = await queryOne(SQL.getStorageRow, [npcId, itemId]);
  const available = row?.quantity ?? 0;
  if (available < quantity) {
    throw new UserFacingError(`Este NPC no tiene suficiente de ese ítem (tiene ${available}, hacen falta ${quantity}).`);
  }
  const result = await execute(SQL.subtractStorage, [quantity, npcId, itemId, quantity]);
  if (result.changes === 0) {
    throw new UserFacingError('Este NPC ya no tiene suficiente de ese ítem.');
  }
}

export async function withdrawFromNpcStorage(discordId, npcId, itemName, quantity) {
  if (!(quantity > 0)) throw new UserFacingError('La cantidad a retirar debe ser mayor que 0.');

  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);
  const row = await queryOne(SQL.getStorageRow, [npcId, item.id]);
  const available = row?.quantity ?? 0;
  if (available < quantity) {
    throw new UserFacingError(`Este NPC solo tiene **${available}** de **${item.display_name}** guardado.`);
  }

  let remaining;
  await withTransaction(async () => {
    const subtractResult = await execute(SQL.subtractStorage, [quantity, npcId, item.id, quantity]);
    if (subtractResult.changes === 0) {
      throw new UserFacingError(`Este NPC ya no tiene suficiente de **${item.display_name}**.`);
    }
    await addItem(discordId, item.name, quantity);
    remaining = (await queryOne(SQL.getStorageRow, [npcId, item.id]))?.quantity ?? 0;
  });

  return { withdrawn: quantity, remaining };
}
