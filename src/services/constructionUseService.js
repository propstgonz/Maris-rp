import { query, queryOne, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { isConstructionRuined } from '../utils/sql.js';
import { resolvePermission } from './permissionService.js';
import { claimCooldown } from './cooldownService.js';
import { settleConstructionProduction } from './productionService.js';
import { rollDie } from '../utils/dice.js';
import { pickConstruction } from './mapService.js';
import { hasEnough, addItem } from './inventoryService.js';
import { getAvailableLaburo, spendLaburo } from './laburoService.js';
import { discordRelativeFromNow } from '../utils/embeds.js';

const SQL = {
  getConstructionWithType: `
    SELECT
      c.id, c.name, c.current_health, c.built_by_player_id,
      t.faction_id AS tile_faction_id,
      ct.id AS type_id, ct.name AS type_name, ct.display_name AS type_display_name,
      ct.max_health AS ct_max_health, ct.use_policy,
      ct.use_tool_item_name, ct.use_result_item_id,
      ct.use_roll_1, ct.use_roll_2, ct.use_roll_3, ct.use_roll_4, ct.use_roll_5, ct.use_roll_6,
      ct.use_laburo_cost, ct.use_cooldown_hours,
      i.name AS result_item_name, i.display_name AS result_item_display, i.emoji AS result_item_emoji
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t         ON c.tile_id = t.id
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    LEFT JOIN ${T.items} i        ON ct.use_result_item_id = i.id
    WHERE t.coord_x = ? AND t.coord_y = ? AND ct.name = ?
  `,

  getPlayerId: `SELECT id, faction_id FROM ${T.players} WHERE discord_id = ?`,

  getCooldownStatus: `
    SELECT TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(last_used_at, INTERVAL ? SECOND)) AS seconds_remaining
    FROM ${T.construction_cooldowns}
    WHERE construction_id = ? AND player_id = ?
  `,
};

export async function useConstruction(discordId, x, y, constructionTypeName, actor = {}, constructionId = null) {
  const construction = pickConstruction(
    await query(SQL.getConstructionWithType, [x, y, constructionTypeName.toLowerCase().trim()]),
    { x, y, typeLabel: constructionTypeName, constructionId }
  );
  if (!construction.use_result_item_id) {
    throw new Error(`**${construction.type_display_name}** no es una construcción interactiva — no tiene nada configurado con \`/construction usar\`.`);
  }
  if (!construction.result_item_name) {
    logger.warn(`[ConstructionUse] Tipo "${construction.type_name}" otorga el ítem #${construction.use_result_item_id} al usarse, que ya no existe en el catálogo.`);
    throw new Error(`**${construction.type_display_name}** está mal configurada (el ítem que da al usarla ya no existe). Avisa a Staff.`);
  }
  if (isConstructionRuined(construction)) {
    throw new Error(`**${construction.name}** está en ruinas — no se puede usar hasta que la reconstruyan.`);
  }

  const player = await queryOne(SQL.getPlayerId, [discordId]);
  if (!player) throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const result = await resolvePermission(
    { discordId, isRolepriest: Boolean(actor.isRolepriest) },
    scope, 'construction.use', construction.use_policy ?? 'any'
  );
  if (!result.allowed) {
    throw new Error(`No puedes usar **${construction.name}** — ${result.reason}.`);
  }

  try {
    await settleConstructionProduction(construction.id);
  } catch (err) {
    logger.warn(`[ConstructionUse] No se pudo liquidar la producción pendiente de "${construction.name}" al usarla: ${err.message}`);
  }

  if (construction.use_tool_item_name && !(await hasEnough(discordId, construction.use_tool_item_name, 1))) {
    throw new Error(`Necesitas tener **${construction.use_tool_item_name}** en tu inventario para usar esto.`);
  }

  const cooldownHours = construction.use_cooldown_hours;
  const cooldownSeconds = Math.round((cooldownHours ?? 0) * 3600);

  const laburoCost = construction.use_laburo_cost ?? 0;
  if (laburoCost > 0) {
    const available = await getAvailableLaburo(discordId);
    if (available < laburoCost) {
      throw new Error(`Necesitas **${laburoCost}** de Laburo para usar esto, tienes **${available.toFixed(2)}**.`);
    }
  }

  const roll = rollDie(6);
  const yieldAmount = construction[`use_roll_${roll}`] ?? 0;

  const claimed = await withTransaction(async () => {
    if (cooldownSeconds > 0) {
      const gotTurn = await claimCooldown(
        T.construction_cooldowns, 'construction_id', construction.id, player.id, cooldownSeconds
      );
      if (!gotTurn) return false;
    }
    if (laburoCost > 0) await spendLaburo(discordId, laburoCost);
    if (yieldAmount > 0) await addItem(discordId, construction.result_item_name, yieldAmount);
    return true;
  });

  if (!claimed) {
    const status = await queryOne(SQL.getCooldownStatus, [cooldownSeconds, construction.id, player.id]);
    throw new Error(
      `Todavía no puedes volver a usar **${construction.name}** — podrás ${discordRelativeFromNow(Math.max(1, status?.seconds_remaining ?? 1))}.`
    );
  }

  logger.info(
    `[ConstructionUse] ${discordId} usó "${construction.name}" (${construction.type_name}) ` +
    `→ tirada ${roll}, ${yieldAmount > 0 ? `+${yieldAmount} ${construction.result_item_name}` : 'sin resultado'}` +
    `${laburoCost > 0 ? `, -${laburoCost} Laburo` : ''}`
  );

  return {
    construction, roll, yieldAmount,
    resultItem: { name: construction.result_item_name, display_name: construction.result_item_display, emoji: construction.result_item_emoji },
    laburoCost, cooldownHours,
  };
}

