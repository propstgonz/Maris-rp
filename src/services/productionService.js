import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { toSqlDatetime, fromSqlDatetime } from '../utils/sqlDatetime.js';
import { isConstructionRuined } from '../utils/sql.js';
import { addToStorage, getStorageContents } from './storageService.js';
import { logAction } from './auditLogService.js';
import { UserFacingError } from '../utils/errors.js';

const FUEL_WARNING_CYCLES = 3;

const SQL = {
  getProducer: `
    SELECT c.id, c.name, c.tile_id, c.current_health, c.fuel_level, c.last_production_at, c.created_at,
           c.built_by_player_id, p.discord_id AS built_by_discord_id, c.consecutive_unmaintained_days,
           t.coord_x, t.coord_y,
           ct.grants_resource_item_id, ct.grants_resource_rate, ct.max_health AS ct_max_health,
           ct.production_interval_hours, ct.max_accrual_hours, ct.storage_capacity,
           ct.fuel_item_id, ct.fuel_consumption_rate, ct.fuel_capacity, ct.maintenance_item_id,
           gi.name AS granted_item_name, gi.display_name AS granted_item_display, gi.weight AS granted_item_weight,
           fi.name AS fuel_item_name, fi.display_name AS fuel_item_display
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.players} p ON c.built_by_player_id = p.id
    LEFT JOIN ${T.items} gi ON ct.grants_resource_item_id = gi.id
    LEFT JOIN ${T.items} fi ON ct.fuel_item_id = fi.id
    WHERE c.id = ?
  `,
  getAllProducers: `
    SELECT c.id
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE ct.grants_resource_item_id IS NOT NULL
      AND (c.last_production_at IS NULL OR c.last_production_at <= DATE_SUB(NOW(), INTERVAL ct.production_interval_hours HOUR))
  `,
  countPendingForPlayer: `
    SELECT COUNT(*) AS cnt
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE ct.grants_resource_item_id IS NOT NULL
      AND c.built_by_player_id = ?
      AND (c.last_production_at IS NULL OR c.last_production_at <= DATE_SUB(NOW(), INTERVAL ct.production_interval_hours HOUR))
  `,
  spendFuel: `UPDATE ${T.constructions} SET fuel_level = fuel_level - ? WHERE id = ?`,
  setLastProduction: `UPDATE ${T.constructions} SET last_production_at = ? WHERE id = ?`,

  getMutableForUpdate: `
    SELECT current_health, fuel_level, last_production_at, consecutive_unmaintained_days
    FROM ${T.constructions} WHERE id = ? FOR UPDATE
  `,
};

export function computeProductionCycles({
  cyclesAvailable, fuelLevel, fuelConsumptionRate,
  storageUsedWeight, storageCapacity, itemWeight, ratePerCycle,
}) {
  const needsFuel = (fuelConsumptionRate ?? 0) > 0;
  let fuelLeft = fuelLevel ?? 0;
  let usedWeight = storageUsedWeight ?? 0;
  let cyclesRun = 0;
  let stoppedReason = null;

  for (let i = 0; i < cyclesAvailable; i++) {
    if (needsFuel && fuelLeft < fuelConsumptionRate) { stoppedReason = 'no_fuel'; break; }

    const addedWeight = ratePerCycle * (itemWeight || 0);
    if (storageCapacity != null && usedWeight + addedWeight > storageCapacity) { stoppedReason = 'storage_full'; break; }

    usedWeight += addedWeight;
    if (needsFuel) fuelLeft -= fuelConsumptionRate;
    cyclesRun++;
  }

  return {
    cyclesRun,
    producedQuantity: cyclesRun * ratePerCycle,
    fuelSpent: needsFuel ? cyclesRun * fuelConsumptionRate : 0,
    stoppedReason,
  };
}

export function cyclesAvailableFor({ lastProductionAt, createdAt, intervalHours, maxAccrualHours }) {
  const since = lastProductionAt ? fromSqlDatetime(lastProductionAt) : fromSqlDatetime(createdAt);
  const elapsedHours = Math.min((Date.now() - since.getTime()) / 3_600_000, maxAccrualHours);
  return Math.floor(elapsedHours / intervalHours);
}

export async function settleConstructionProduction(constructionId, { audit = false } = {}) {
  const c = await queryOne(SQL.getProducer, [constructionId]);
  if (!c || !c.grants_resource_item_id || !c.grants_resource_rate) {
    return { cyclesRun: 0, produced: 0, itemName: null, stoppedReason: null, fuelAlert: null };
  }
  if (!c.granted_item_name) {
    logger.warn(`[Production] Construcción #${constructionId} "${c.name}" otorga el ítem #${c.grants_resource_item_id}, que ya no existe en el catálogo.`);
    throw new UserFacingError(`**${c.name}** está mal configurada (el ítem que otorga ya no existe en el catálogo). Avisa a Staff.`);
  }

  const intervalHours = c.production_interval_hours ?? 24;
  const maxAccrualHours = c.max_accrual_hours ?? 48;

  return withTransaction(async () => {
    const locked = await queryOne(SQL.getMutableForUpdate, [constructionId]);
    if (!locked) {
      return { cyclesRun: 0, produced: 0, itemName: null, stoppedReason: null, fuelAlert: null };
    }
    if (isConstructionRuined({ current_health: locked.current_health, ct_max_health: c.ct_max_health })) {
      return { cyclesRun: 0, produced: 0, itemName: null, stoppedReason: null, fuelAlert: null };
    }
    if (c.maintenance_item_id != null && locked.consecutive_unmaintained_days > 0) {
      return { cyclesRun: 0, produced: 0, itemName: c.granted_item_name, stoppedReason: 'unmaintained', fuelAlert: null };
    }

    const since = locked.last_production_at ? fromSqlDatetime(locked.last_production_at) : fromSqlDatetime(c.created_at);
    const cyclesAvailable = cyclesAvailableFor({
      lastProductionAt: locked.last_production_at, createdAt: c.created_at, intervalHours, maxAccrualHours,
    });

    if (cyclesAvailable <= 0) {
      return { cyclesRun: 0, produced: 0, itemName: c.granted_item_name, stoppedReason: null, fuelAlert: null };
    }

    const storageContents = await getStorageContents(constructionId);
    const storageUsedWeight = storageContents.reduce((sum, row) => sum + row.quantity * row.weight, 0);

    const plan = computeProductionCycles({
      cyclesAvailable,
      fuelLevel: locked.fuel_level,
      fuelConsumptionRate: c.fuel_consumption_rate,
      storageUsedWeight,
      storageCapacity: c.storage_capacity,
      itemWeight: c.granted_item_weight ?? 0,
      ratePerCycle: c.grants_resource_rate,
    });

    let fuelAlert = null;
    const needsFuel = (c.fuel_consumption_rate ?? 0) > 0;
    if (plan.cyclesRun > 0) {
      await addToStorage(constructionId, c.granted_item_name, plan.producedQuantity, c.storage_capacity);
      if (plan.fuelSpent > 0) {
        await execute(SQL.spendFuel, [plan.fuelSpent, constructionId]);
      }
      const newLastProduction = new Date(since.getTime() + plan.cyclesRun * intervalHours * 3_600_000);
      await execute(SQL.setLastProduction, [toSqlDatetime(newLastProduction), constructionId]);

      if (audit) {
        await logAction({
          source: 'discord', actorDiscordId: c.built_by_discord_id ?? 'system', actorUsername: c.name,
          action: 'tile.construction_production', target: `(${c.coord_x},${c.coord_y})`,
          details: { constructionId, itemName: c.granted_item_name, quantity: plan.producedQuantity },
        });
      }
    }

    if (c.built_by_discord_id && needsFuel) {
      const fuelLeftAfter = (locked.fuel_level ?? 0) - plan.fuelSpent;
      if (plan.stoppedReason === 'no_fuel') {
        fuelAlert = {
          kind: 'empty', discordId: c.built_by_discord_id, constructionName: c.name,
          itemName: c.granted_item_name, fuelLevel: fuelLeftAfter,
          fuelNeeded: c.fuel_consumption_rate, fuelItemName: c.fuel_item_name,
        };
      } else if (plan.cyclesRun > 0) {
        const cyclesLeft = Math.floor(fuelLeftAfter / c.fuel_consumption_rate);
        if (cyclesLeft <= FUEL_WARNING_CYCLES) {
          fuelAlert = {
            kind: 'low', daysLeft: cyclesLeft, discordId: c.built_by_discord_id, constructionName: c.name,
            itemName: c.granted_item_name, fuelLevel: fuelLeftAfter,
            fuelNeeded: c.fuel_consumption_rate, fuelItemName: c.fuel_item_name,
          };
        }
      }
    }

    return { cyclesRun: plan.cyclesRun, produced: plan.producedQuantity, itemName: c.granted_item_name, stoppedReason: plan.stoppedReason, fuelAlert };
  });
}

export async function flushDueProduction() {
  const due = await query(SQL.getAllProducers);
  const produced = [];
  const fuelAlerts = [];

  for (const { id } of due) {
    try {
      const result = await settleConstructionProduction(id, { audit: true });
      if (result.cyclesRun > 0) {
        produced.push({ constructionId: id, itemName: result.itemName, quantity: result.produced });
      }
      if (result.fuelAlert) fuelAlerts.push(result.fuelAlert);
    } catch (err) {
      logger.error(`[Production] Error liquidando producción de construcción #${id}: ${err.message}`);
    }
  }

  return { processed: due.length, produced, fuelAlerts };
}

export async function getPlayerPendingProductionCount(playerId) {
  const row = await queryOne(SQL.countPendingForPlayer, [playerId]);
  return row?.cnt ?? 0;
}
