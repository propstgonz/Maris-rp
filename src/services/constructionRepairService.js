



























import logger from '../utils/logger.js';
import { withTransaction } from '../database/index.js';
import { UserFacingError } from '../utils/errors.js';
import { isConstructionRuined } from '../utils/sql.js';
import { round2 } from '../utils/math.js';
import { resolvePermission } from './permissionService.js';
import { hasEnough, removeItem } from './inventoryService.js';
import { getAvailableLaburo, spendLaburo } from './laburoService.js';
import { resolveConstructionAtTile, repairConstructionHealth } from './mapService.js';
import { getConstructionTypeByName, getIngredients } from './constructionTypeService.js';

export const REPAIR_INGREDIENT_FRACTION = 0.5;


export function computeRepairCost(constructionType, fullIngredients) {
  const ingredients = fullIngredients.map(ing => ({
    ...ing,
    quantity_required: Math.max(1, Math.ceil(ing.quantity_required * REPAIR_INGREDIENT_FRACTION)),
  }));
  const laburoCost = constructionType.laburo_cost > 0 ? round2(constructionType.laburo_cost * REPAIR_INGREDIENT_FRACTION) : 0;
  return { ingredients, laburoCost };
}


export async function repairConstruction(discordId, x, y, constructionTypeName, actor = {}, constructionId = null) {
  const constructionType = await getConstructionTypeByName(constructionTypeName.toLowerCase().trim());
  if (!constructionType) {
    throw new UserFacingError(`No existe ningún tipo de construcción llamado \`${constructionTypeName}\`. Usa \`/build list\`.`);
  }

  const construction = await resolveConstructionAtTile(x, y, constructionType, constructionId);
  if (!isConstructionRuined(construction)) {
    throw new UserFacingError(
      `**${construction.name}** no está en ruinas — no hay nada que reparar ` +
      `(vida: ${construction.current_health}/${construction.ct_max_health ?? 10}).`
    );
  }

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const permResult = await resolvePermission(
    { discordId, isRolepriest: Boolean(actor.isRolepriest) },
    scope, 'construction.repair', construction.repair_policy ?? 'any'
  );
  if (!permResult.allowed) {
    throw new UserFacingError(`No puedes reparar **${construction.name}** — ${permResult.reason}.`);
  }

  const { ingredients: repairIngredients, laburoCost } = computeRepairCost(constructionType, await getIngredients(constructionType.id));

  const missing = [];
  for (const ing of repairIngredients) {
    if (!(await hasEnough(discordId, ing.name, ing.quantity_required))) {
      missing.push(`${ing.emoji ?? '📦'} **${ing.display_name}**: necesitas **${ing.quantity_required}**`);
    }
  }
  if (laburoCost > 0) {
    const haveLaburo = await getAvailableLaburo(discordId);
    if (haveLaburo < laburoCost) {
      missing.push(`💪 **Laburo**: necesitas **${laburoCost}**, tienes **${haveLaburo.toFixed(2)}**`);
    }
  }
  if (missing.length > 0) {
    throw new UserFacingError(`Materiales insuficientes para la reparación (mitad del coste de construirla):\n${missing.join('\n')}`);
  }

  const repaired = await withTransaction(async () => {
    for (const ing of repairIngredients) {
      await removeItem(discordId, ing.name, ing.quantity_required);
    }
    if (laburoCost > 0) {
      await spendLaburo(discordId, laburoCost);
    }
    return await repairConstructionHealth(construction.id);
  });

  logger.info(
    `[ConstructionRepair] ${discordId} reparó "${repaired.name}" (${constructionType.name}) @ (${x},${y}) — ` +
    `${repairIngredients.map(i => `${i.name}×${i.quantity_required}`).join(', ') || 'sin ingredientes'}` +
    `${laburoCost > 0 ? `, Laburo×${laburoCost}` : ''}`
  );

  return { construction: repaired, constructionType, ingredients: repairIngredients, laburoCost };
}
