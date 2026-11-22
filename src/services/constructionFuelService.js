




















import { query, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { isConstructionRuined } from '../utils/sql.js';
import { resolvePermission } from './permissionService.js';
import { pickConstruction } from './mapService.js';
import { hasEnough, removeItem } from './inventoryService.js';

const SQL = {
  getConstructionWithType: `
    SELECT
      c.id, c.name, c.current_health, c.fuel_level, c.built_by_player_id,
      t.faction_id AS tile_faction_id,
      ct.id AS type_id, ct.display_name AS type_display_name,
      ct.max_health AS ct_max_health, ct.refuel_policy,
      ct.fuel_item_id, ct.fuel_consumption_rate, ct.fuel_capacity,
      i.name AS fuel_item_name, i.display_name AS fuel_item_display, i.emoji AS fuel_item_emoji
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t           ON c.tile_id = t.id
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    LEFT JOIN ${T.items} i          ON ct.fuel_item_id = i.id
    WHERE t.coord_x = ? AND t.coord_y = ? AND ct.name = ?
  `,

  addFuel: `UPDATE ${T.constructions} SET fuel_level = fuel_level + ? WHERE id = ?`,
};


export async function refuelConstruction(discordId, x, y, constructionTypeName, quantity, actor = {}, constructionId = null) {
  if (!(quantity > 0)) {
    throw new Error('La cantidad a repostar debe ser mayor que 0.');
  }



  const construction = pickConstruction(
    await query(SQL.getConstructionWithType, [x, y, constructionTypeName.toLowerCase().trim()]),
    { x, y, typeLabel: constructionTypeName, constructionId }
  );
  if (!construction.fuel_item_id) {
    throw new Error(`**${construction.type_display_name}** no exige combustible — no hay nada que repostar.`);
  }
  if (isConstructionRuined(construction)) {
    throw new Error(`**${construction.name}** está en ruinas — repostarla no serviría de nada hasta que la reconstruyan.`);
  }

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const result = await resolvePermission(
    { discordId, isRolepriest: Boolean(actor.isRolepriest) },
    scope, 'construction.refuel', construction.refuel_policy ?? 'any'
  );
  if (!result.allowed) {
    throw new Error(`No puedes repostar **${construction.name}** — ${result.reason}.`);
  }

  if (!(await hasEnough(discordId, construction.fuel_item_name, quantity))) {
    throw new Error(`No tienes **${quantity}** de **${construction.fuel_item_display}** en tu inventario.`);
  }

  const capacity = construction.fuel_capacity;
  const room = capacity != null ? Math.max(0, capacity - construction.fuel_level) : Infinity;
  if (room <= 0) {
    throw new Error(`El depósito de **${construction.name}** ya está lleno (${construction.fuel_level}/${capacity}).`);
  }

  const added = Math.min(quantity, room);

  await withTransaction(async () => {
    await removeItem(discordId, construction.fuel_item_name, added);
    await execute(SQL.addFuel, [added, construction.id]);
  });

  const newLevel = construction.fuel_level + added;

  logger.info(
    `[ConstructionFuel] ${discordId} repostó "${construction.name}" con +${added} ${construction.fuel_item_name} ` +
    `(${newLevel}${capacity != null ? `/${capacity}` : ''})`
  );

  return {
    construction,
    fuelItem: { name: construction.fuel_item_name, display_name: construction.fuel_item_display, emoji: construction.fuel_item_emoji },
    added,
    requested: quantity,
    newLevel,
    capacity,
  };
}
