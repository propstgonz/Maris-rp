import { query, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { CONSTRUCTION_ALIVE_SQL } from '../utils/sql.js';
import { resolvePermission } from './permissionService.js';
import { hasEnough } from './inventoryService.js';
import { getConstructionTypeByName } from './constructionTypeService.js';
import { resolveConstructionAtTile, getConstructionById } from './mapService.js';

const SQL = {
  getDecayingConstructions: `
    SELECT c.id, COALESCE(c.durability, ct.max_durability) AS current_durability, ct.durability_loss_per_day
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE ct.durability_loss_per_day IS NOT NULL AND (${CONSTRUCTION_ALIVE_SQL})
  `,
  setDurability: `UPDATE ${T.constructions} SET durability = ? WHERE id = ?`,
};

export function computeDurabilityAfterDecay(currentDurability, lossPerDay) {
  return Math.max(0, currentDurability - lossPerDay);
}

export async function processDurabilityDecay() {
  const rows = await query(SQL.getDecayingConstructions);
  let updated = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const next = computeDurabilityAfterDecay(row.current_durability, row.durability_loss_per_day);
      await execute(SQL.setDurability, [next, row.id]);
      updated++;
    } catch (err) {
      errors++;
      logger.warn(`[ConstructionDurability] No se pudo aplicar el desgaste diario a la construcción #${row.id}: ${err.message}`);
    }
  }

  logger.info(`[ConstructionDurability] Desgaste diario aplicado: ${updated} construcción(es) desgastada(s), ${errors} error(es)`);
  return { updated, errors };
}

export async function restoreDurability(discordId, x, y, constructionTypeName, actor = {}, constructionId = null) {
  const constructionType = await getConstructionTypeByName(constructionTypeName.toLowerCase().trim());
  if (!constructionType) {
    throw new UserFacingError(`No existe ningún tipo de construcción llamado \`${constructionTypeName}\`. Usa \`/build list\`.`);
  }
  if (constructionType.durability_loss_per_day == null) {
    throw new UserFacingError(`**${constructionType.display_name}** no tiene sistema de durabilidad configurado — no hay nada que restaurar.`);
  }

  const construction = await resolveConstructionAtTile(x, y, constructionType, constructionId);

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const permResult = await resolvePermission(
    { discordId, isRolepriest: Boolean(actor.isRolepriest) },
    scope, 'construction.repair', construction.repair_policy ?? 'any'
  );
  if (!permResult.allowed) {
    throw new UserFacingError(`No puedes restaurar la durabilidad de **${construction.name}** — ${permResult.reason}.`);
  }

  const toolName = constructionType.durability_repair_tool_item_name;
  if (toolName && !(await hasEnough(discordId, toolName, 1))) {
    throw new UserFacingError(`Necesitas tener **${toolName}** en tu inventario para restaurar la durabilidad de esto (no se gasta).`);
  }

  const maxDurability = constructionType.max_durability;
  const previousDurability = construction.durability ?? maxDurability;
  if (previousDurability >= maxDurability) {
    throw new UserFacingError(`**${construction.name}** ya está a durabilidad máxima (${maxDurability}).`);
  }

  await execute(SQL.setDurability, [maxDurability, construction.id]);

  logger.info(
    `[ConstructionDurability] ${discordId} restauró la durabilidad de "${construction.name}" (${constructionType.name}) @ (${x},${y}): ${previousDurability} → ${maxDurability}`
  );

  return { construction: await getConstructionById(construction.id), constructionType, previousDurability, maxDurability };
}
