import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { CONSTRUCTION_ALIVE_SQL, isConstructionRuined } from '../utils/sql.js';
import { resolvePermission } from './permissionService.js';
import { settleConstructionProduction } from './productionService.js';
import { getTerrainTypeByName } from './terrainTypeService.js';
import { getEffectType } from './effectTypesService.js';
import { applyEffect, removeTileSourcedEffect, getPlayersAtTile, getSpawnCoords } from './playerService.js';
import { getNpcAtTile, getNpcsAtTile } from './npcService.js';
import { getItemsAtTile } from './tileItemService.js';
import { getPointsOfInterest } from './poiService.js';
import { getSetting, setSetting } from './settingsService.js';
import { regenerateTemperaturesForRange } from './temperatureService.js';

const MAP_MAX_COORDINATE_SETTING_KEY = 'map_max_coordinate';
const DEFAULT_MAP_MAX_COORDINATE = 100;

export async function getMapMaxCoordinate() {
  const raw = Number(await getSetting(MAP_MAX_COORDINATE_SETTING_KEY, String(DEFAULT_MAP_MAX_COORDINATE)));
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAP_MAX_COORDINATE;
}

export async function setMapMaxCoordinate(max) {
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error('El límite máximo de coordenada del mapa debe ser un número entero mayor que 0.');
  }
  await setSetting(MAP_MAX_COORDINATE_SETTING_KEY, String(max));
}

const SQL = {
  getTile: `
    SELECT * FROM ${T.map_tiles} WHERE coord_x = ? AND coord_y = ?
  `,

  getZoneByName: `SELECT id FROM ${T.zones} WHERE name = ?`,

  getTileWithOwner: `
    SELECT
      t.*,
      tt.name                        AS terrain_name,
      tt.display_name                AS terrain_display_name,
      tt.emoji                       AS terrain_emoji,
      tt.color                       AS terrain_color,
      tt.requires_vehicle_category   AS terrain_requires_vehicle_category,
      p.discord_id  AS owner_discord_id,
      p.username    AS owner_username,
      n.name         AS faction_name,
      n.display_name AS faction_display_name,
      n.emoji        AS faction_emoji,
      z.name         AS zone_name,
      z.display_name AS zone_display_name,
      z.emoji        AS zone_emoji,
      z.color        AS zone_color
    FROM ${T.map_tiles} t
    JOIN ${T.terrain_types} tt ON t.terrain_type_id = tt.id
    LEFT JOIN ${T.players} p  ON t.owner_player_id = p.id
    LEFT JOIN ${T.factions} n  ON t.faction_id       = n.id
    LEFT JOIN ${T.zones} z     ON t.zone_id          = z.id
    WHERE t.coord_x = ? AND t.coord_y = ?
  `,

  getAllTiles: `
    SELECT
      t.*,
      tt.name AS terrain_name, tt.display_name AS terrain_display_name,
      tt.emoji AS terrain_emoji, tt.color AS terrain_color,
      p.username AS owner_username
    FROM ${T.map_tiles} t
    JOIN ${T.terrain_types} tt ON t.terrain_type_id = tt.id
    LEFT JOIN ${T.players} p ON t.owner_player_id = p.id
    ORDER BY t.coord_x ASC, t.coord_y ASC
  `,

  insertTile: `
    INSERT INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id, description)
    VALUES (?, ?, ?, ?, ?)
  `,

  insertTileIfMissing: `
    INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id, description)
    VALUES (?, ?, ?, ?, ?)
  `,

  insertTileRangeIfMissing: `
    INSERT IGNORE INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id, description, resource_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `,

  upsertTileTerrain: `
    INSERT INTO ${T.map_tiles} (coord_x, coord_y, name, terrain_type_id)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      terrain_type_id = VALUES(terrain_type_id),
      name            = VALUES(name)
  `,

  setOwnerToPlayer: `
    UPDATE ${T.map_tiles} SET owner_player_id = ?
    WHERE coord_x = ? AND coord_y = ?
  `,

  clearOwner: `
    UPDATE ${T.map_tiles} SET owner_player_id = NULL
    WHERE coord_x = ? AND coord_y = ?
  `,

  deleteTile: `
    DELETE FROM ${T.map_tiles} WHERE coord_x = ? AND coord_y = ?
  `,

  getConstructionsByTile: `
    SELECT
      c.id,
      c.name,
      c.construction_type,
      c.construction_type_id,
      c.resource_bonus,
      c.current_health,
      c.fuel_level,
      c.durability,
      c.created_at,
      c.built_by_player_id,
      p.username        AS builder_username,
      p.discord_id      AS builder_discord_id,
      i.name            AS unlocks_item_name,
      i.display_name    AS unlocks_item_display,
      ct.name           AS ct_name,
      ct.display_name   AS ct_display_name,
      ct.emoji          AS ct_emoji,
      ct.max_health     AS ct_max_health,
      ct.max_durability AS ct_max_durability,
      ct.durability_loss_per_day AS ct_durability_loss_per_day,
      ct.fuel_capacity  AS ct_fuel_capacity,
      ct.fuel_consumption_rate AS ct_fuel_consumption_rate,
      fi.name           AS ct_fuel_item_name,
      fi.display_name   AS ct_fuel_item_display,
      fi.emoji          AS ct_fuel_item_emoji
    FROM ${T.constructions} c
    LEFT JOIN ${T.players} p             ON c.built_by_player_id  = p.id
    LEFT JOIN ${T.recipes} r             ON c.unlocks_recipe_id   = r.id
    LEFT JOIN ${T.items} i               ON r.result_item_id       = i.id
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    LEFT JOIN ${T.items} fi              ON ct.fuel_item_id         = fi.id
    WHERE c.tile_id = ?
    ORDER BY c.created_at ASC
  `,

  getConstructionsInRadius: `
    SELECT c.id, c.name, c.current_health,
           t.coord_x, t.coord_y,
           ct.name AS ct_name, ct.display_name AS ct_display_name,
           ct.emoji AS ct_emoji, ct.max_health AS ct_max_health
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE t.coord_x BETWEEN ? AND ?
      AND t.coord_y BETWEEN ? AND ?
      AND COALESCE(c.current_health, ct.max_health, 10) > 0
      AND ct.name IS NOT NULL
  `,

  getConstructionById: `
    SELECT c.*, t.coord_x, t.coord_y, t.name AS tile_name, t.faction_id AS tile_faction_id,
           ct.name AS ct_name, ct.display_name AS ct_display_name, ct.emoji AS ct_emoji,
           ct.max_health AS ct_max_health, ct.fuel_capacity AS ct_fuel_capacity,
           ct.max_durability AS ct_max_durability,
           gi.name AS granted_item_name, ct.grants_resource_rate AS granted_resource_rate,
           ct.destroy_policy AS destroy_policy
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    LEFT JOIN ${T.items} gi              ON ct.grants_resource_item_id = gi.id
    WHERE c.id = ?
  `,

  updateConstructionInstance: `
    UPDATE ${T.constructions} SET current_health = ?, fuel_level = ?, durability = ? WHERE id = ?
  `,

  getConstructionsByTypeAndTile: `
    SELECT c.*, t.coord_x, t.coord_y, t.name AS tile_name, t.faction_id AS tile_faction_id,
           ct.max_health AS ct_max_health, ct.display_name AS ct_display_name,
           ct.grants_resource_item_id AS ct_grants_resource_item_id,
           ct.repair_policy AS repair_policy, ct.is_market AS is_market, ct.storage_capacity AS storage_capacity
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE c.tile_id = ? AND c.construction_type_id = ?
    ORDER BY c.id ASC
  `,

  countConstructionsAtTile: `
    SELECT COUNT(*) AS total FROM ${T.constructions} WHERE tile_id = ?
  `,

  countConstructionsOfTypeAtTile: `
    SELECT COUNT(*) AS total FROM ${T.constructions} WHERE tile_id = ? AND construction_type_id = ?
  `,

  getConstructionByTypeAndTile: `
    SELECT c.*, t.coord_x, t.coord_y, t.name AS tile_name, t.faction_id AS tile_faction_id,
           ct.max_health AS ct_max_health, ct.display_name AS ct_display_name,
           ct.grants_resource_item_id AS ct_grants_resource_item_id,
           ct.repair_policy AS repair_policy, ct.is_market AS is_market, ct.storage_capacity AS storage_capacity
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    LEFT JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE c.tile_id = ? AND c.construction_type_id = ?
    LIMIT 1
  `,

  insertConstructionInstance: `
    INSERT INTO ${T.constructions} (tile_id, name, construction_type_id, unlocks_recipe_id, built_by_player_id, current_health)
    VALUES (?, ?, ?, ?, ?, ?)
  `,

  deleteConstruction: `DELETE FROM ${T.constructions} WHERE id = ?`,

  setConstructionHealth: `UPDATE ${T.constructions} SET current_health = ? WHERE id = ?`,

  getConstructionHealthForUpdate: `SELECT current_health FROM ${T.constructions} WHERE id = ? FOR UPDATE`,

  getItemNameById: `SELECT name FROM ${T.items} WHERE id = ?`,

  getGeneratorsByTile: `
    SELECT tg.id, tg.generation_rate, i.name AS item_name, i.display_name, i.emoji
    FROM ${T.tile_resource_generators} tg
    JOIN ${T.items} i ON tg.item_id = i.id
    WHERE tg.tile_id = ?
    ORDER BY i.item_type, i.display_name
  `,

  upsertGenerator: `
    INSERT INTO ${T.tile_resource_generators} (tile_id, item_id, generation_rate)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE generation_rate = VALUES(generation_rate)
  `,

  deleteGenerator: `
    DELETE FROM ${T.tile_resource_generators} WHERE tile_id = ? AND item_id = ?
  `,

  getTotalConstructionBonus: `
    SELECT COALESCE(SUM(resource_bonus), 0) AS total_bonus
    FROM ${T.constructions} WHERE tile_id = ?
  `,

  getPlayerIdByDiscordId: `SELECT id FROM ${T.players} WHERE discord_id = ?`,
  getItemByName:          `SELECT id, display_name FROM ${T.items} WHERE name = ?`,
  getRecipeForItem:       `
    SELECT r.id FROM ${T.recipes} r
    JOIN ${T.items} i ON r.result_item_id = i.id
    WHERE i.name = ?
  `,

  updatePlayerPos: `
    UPDATE ${T.players}
    SET coord_x = ?, coord_y = ?, updated_at = NOW()
    WHERE discord_id = ?
  `,

  getPlayerPosByDiscordId: `
    SELECT coord_x, coord_y FROM ${T.players} WHERE discord_id = ?
  `,

  getTilesInRegion: `
    SELECT
      t.id, t.coord_x, t.coord_y, t.name,
      tt.name AS terrain_name, tt.display_name AS terrain_display_name,
      tt.emoji AS terrain_emoji, tt.color AS terrain_color,
      t.resource_type, t.temperature,
      n.name AS faction_name, n.display_name AS faction_display_name, n.emoji AS faction_emoji,
      z.name AS zone_name, z.display_name AS zone_display_name, z.emoji AS zone_emoji, z.color AS zone_color,
      p.username AS owner_username,
      (SELECT COUNT(*) FROM ${T.tile_items} ti WHERE ti.tile_id = t.id) AS item_count,
      (SELECT COUNT(*) FROM ${T.constructions} c WHERE c.tile_id = t.id) AS construction_count,
      (SELECT COUNT(*) FROM ${T.players} pl WHERE pl.coord_x = t.coord_x AND pl.coord_y = t.coord_y AND pl.is_alive = 1 AND pl.character_created_at IS NOT NULL) AS player_count,
      (SELECT COUNT(*) FROM ${T.tile_resource_generators} tg WHERE tg.tile_id = t.id) AS generator_count
    FROM ${T.map_tiles} t
    JOIN ${T.terrain_types} tt ON t.terrain_type_id = tt.id
    LEFT JOIN ${T.players} p ON t.owner_player_id = p.id
    LEFT JOIN ${T.factions} n ON t.faction_id = n.id
    LEFT JOIN ${T.zones} z ON t.zone_id = z.id
    WHERE t.coord_x BETWEEN ? AND ? AND t.coord_y BETWEEN ? AND ?
    ORDER BY t.coord_x ASC, t.coord_y ASC
  `,

  getTilesInRegionWithMedia: `
    SELECT
      t.id, t.coord_x, t.coord_y, t.name, t.resource_type, t.zone_id, t.temperature,
      tt.name AS terrain_name, tt.display_name AS terrain_display_name,
      tt.emoji AS terrain_emoji, tt.color AS terrain_color,
      z.name AS zone_name, z.display_name AS zone_display_name, z.emoji AS zone_emoji, z.color AS zone_color,
      p.username AS owner_username,
      (SELECT COUNT(*) FROM ${T.tile_items} ti WHERE ti.tile_id = t.id) AS item_count,
      (SELECT COUNT(*) FROM ${T.constructions} c WHERE c.tile_id = t.id) AS construction_count,
      (SELECT COUNT(*) FROM ${T.players} pl WHERE pl.coord_x = t.coord_x AND pl.coord_y = t.coord_y AND pl.is_alive = 1 AND pl.character_created_at IS NOT NULL) AS player_count,
      (SELECT JSON_ARRAYAGG(avatar_filename) FROM (
        SELECT avatar_filename FROM ${T.players}
        WHERE coord_x = t.coord_x AND coord_y = t.coord_y AND is_alive = 1 AND character_created_at IS NOT NULL
        LIMIT 9
      ) avatars) AS player_avatars_json,
      (SELECT JSON_ARRAYAGG(JSON_OBJECT('image', cthumb.image_filename, 'emoji', cthumb.emoji)) FROM (
        SELECT ct.image_filename, ct.emoji
        FROM ${T.constructions} c JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
        WHERE c.tile_id = t.id
        LIMIT 9
      ) cthumb) AS construction_thumbs_json,
      (SELECT COUNT(*) FROM ${T.tile_resource_generators} tg WHERE tg.tile_id = t.id) AS generator_count,
      (SELECT JSON_ARRAYAGG(gthumb.emoji) FROM (
        SELECT i.emoji
        FROM ${T.tile_resource_generators} tg JOIN ${T.items} i ON tg.item_id = i.id
        WHERE tg.tile_id = t.id
        LIMIT 9
      ) gthumb) AS generator_thumbs_json
    FROM ${T.map_tiles} t
    JOIN ${T.terrain_types} tt ON t.terrain_type_id = tt.id
    LEFT JOIN ${T.players} p ON t.owner_player_id = p.id
    LEFT JOIN ${T.zones} z ON t.zone_id = z.id
    WHERE t.coord_x BETWEEN ? AND ? AND t.coord_y BETWEEN ? AND ?
    ORDER BY t.coord_x ASC, t.coord_y ASC
  `,

  countLandingSitesAtTile: `
    SELECT COUNT(*) AS cnt
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t          ON c.tile_id = t.id
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE t.coord_x = ? AND t.coord_y = ? AND ct.is_landing_site = 1
      AND (${CONSTRUCTION_ALIVE_SQL})
  `,

  getBestTravelCostMultiplierAtTile: `
    SELECT MIN(ct.travel_cost_multiplier) AS best
    FROM ${T.constructions} c
    JOIN ${T.map_tiles} t          ON c.tile_id = t.id
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    WHERE t.coord_x = ? AND t.coord_y = ?
      AND (${CONSTRUCTION_ALIVE_SQL})
  `,
};

async function resolveTileId(x, y) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) {
    throw new Error(
      `No existe ninguna casilla en **(${x}, ${y})**. ` +
      `Créala primero con \`/map create\`.`
    );
  }
  return tile.id;
}

async function resolveTerrainTypeId(terrainName) {
  const terrain = await getTerrainTypeByName(terrainName);
  if (!terrain) {
    throw new Error(`No existe ningún tipo de terreno llamado \`${terrainName}\`. Usa \`/terrain list\` para ver los disponibles.`);
  }
  return terrain.id;
}

export async function getTile(x, y) {
  return (await queryOne(SQL.getTile, [x, y])) ?? null;
}

export async function getTileWithDetails(x, y) {
  const tile = await queryOne(SQL.getTileWithOwner, [x, y]);
  if (!tile) return null;

  const pending = await query(SQL.getConstructionsByTile, [tile.id]);
  for (const p of pending) {
    try {
      await settleConstructionProduction(p.id);
    } catch (err) {
      logger.warn(`[MapService] No se pudo liquidar la producción pendiente de la construcción #${p.id} al mirar la casilla: ${err.message}`);
    }
  }

  const constructions = pending.length > 0 ? await query(SQL.getConstructionsByTile, [tile.id]) : pending;
  const generators    = await query(SQL.getGeneratorsByTile, [tile.id]);
  const players       = await getPlayersAtTile(x, y);

  const npcs          = await getNpcsAtTile(x, y);
  const pointsOfInterest = await getPointsOfInterest(tile.id);
  const { total_bonus } = await queryOne(SQL.getTotalConstructionBonus, [tile.id]);

  return { ...tile, constructions, generators, players, npcs, points_of_interest: pointsOfInterest, total_bonus: total_bonus ?? 0 };
}

export async function getAllTiles() {
  return query(SQL.getAllTiles);
}

export async function getTilesInRegion(minX, minY, maxX, maxY, { withMedia = true } = {}) {
  const sql = withMedia ? SQL.getTilesInRegionWithMedia : SQL.getTilesInRegion;
  return query(sql, [minX, maxX, minY, maxY]);
}

export async function createTile(x, y, name, tileType, description = '') {
  if (x < 0 || y < 0) {
    throw new Error(`No se pueden crear casillas en coordenadas negativas — (${x}, ${y}) queda fuera del mapa.`);
  }
  const terrainTypeId = await resolveTerrainTypeId(tileType);
  try {
    await execute(SQL.insertTile, [x, y, name, terrainTypeId, description]);
  } catch (err) {
    if (err.message.toLowerCase().includes('unique')) {
      throw new Error(`Ya existe una casilla en **(${x}, ${y})**. Usa \`/map edit\` para modificarla.`);
    }
    throw err;
  }

  await regenerateTemperaturesForRange(x, y, x, y);

  logger.info(`[MapService] Casilla creada: "${name}" (${tileType}) @ (${x},${y})`);
  return queryOne(SQL.getTileWithOwner, [x, y]);
}

export async function deleteTile(x, y) {
  const tile = await queryOne(SQL.getTileWithOwner, [x, y]);
  if (!tile) throw new Error(`No existe ninguna casilla en (${x}, ${y}).`);

  const players = await getPlayersAtTile(x, y);
  if (players.length > 0) {
    throw new Error(`No se puede borrar (${x}, ${y}): hay **${players.length}** jugador(es) ahí ahora mismo.`);
  }
  const constructions = await query(SQL.getConstructionsByTile, [tile.id]);
  if (constructions.length > 0) {
    throw new Error(`No se puede borrar (${x}, ${y}): hay **${constructions.length}** construcción(es) — quítalas primero.`);
  }
  const generators = await query(SQL.getGeneratorsByTile, [tile.id]);
  if (generators.length > 0) {
    throw new Error(`No se puede borrar (${x}, ${y}): tiene generador(es) de recursos configurados — quítalos primero.`);
  }
  const tileItems = await getItemsAtTile(x, y);
  if (tileItems.length > 0) {
    throw new Error(`No se puede borrar (${x}, ${y}): hay ítems en el suelo — se perderían sin más.`);
  }
  if (await getNpcAtTile(x, y)) {
    throw new Error(`No se puede borrar (${x}, ${y}): hay un NPC ahí — quítalo primero.`);
  }
  const spawn = await getSpawnCoords();
  if (spawn.x === x && spawn.y === y) {
    throw new Error(`(${x}, ${y}) es la casilla de aparición de personajes nuevos — cambia el spawn antes de borrarla.`);
  }

  await execute(SQL.deleteTile, [x, y]);
  logger.info(`[MapService] Casilla borrada: "${tile.name}" @ (${x},${y})`);
  return tile;
}

export const MAX_RANGE_TILES = 2500;

export function normalizeRange(x1, y1, x2, y2) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const total = (maxX - minX + 1) * (maxY - minY + 1);
  if (total > MAX_RANGE_TILES) {
    throw new Error(
      `El rango (${minX},${minY})-(${maxX},${maxY}) cubre ${total} casillas posibles — el máximo por operación es ${MAX_RANGE_TILES}. Divídelo en rangos más pequeños.`
    );
  }
  return { minX, maxX, minY, maxY };
}

export async function createTileRange(x1, y1, x2, y2, name, tileType, description = '', resourceType = null) {
  resourceType = resourceType ? resourceType.trim().toLowerCase() : null;
  const terrainTypeId = await resolveTerrainTypeId(tileType);
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  const total = (maxX - minX + 1) * (maxY - minY + 1);

  if (minX < 0 || minY < 0) {
    throw new Error(`No se pueden crear casillas en coordenadas negativas — el rango incluye (${minX}, ${minY}), fuera del mapa.`);
  }
  if (total > MAX_RANGE_TILES) {
    throw new Error(
      `El rango (${minX},${minY})-(${maxX},${maxY}) cubre ${total} casillas posibles — el máximo por operación es ${MAX_RANGE_TILES}. Divídelo en llamadas más pequeñas.`
    );
  }

  const created = await withTransaction(async () => {
    let n = 0;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const info = await execute(SQL.insertTileRangeIfMissing, [x, y, name, terrainTypeId, description, resourceType]);
        if (info.changes > 0) n++;
      }
    }
    return n;
  });
  const skipped = total - created;
  if (created > 0) await regenerateTemperaturesForRange(minX, minY, maxX, maxY);

  logger.info(
    `[MapService] 🗺️ Rango creado: ${created} casilla(s) nueva(s), ${skipped} ya existían — ` +
    `(${minX},${minY})-(${maxX},${maxY}) "${name}" (${tileType})`
  );

  return { created, skipped, minX, maxX, minY, maxY };
}

export async function seedStarterGrid({
  originX  = 0,
  originY  = 0,
  width    = 10,
  height   = 10,
  name     = 'Llanura',
  tileType = 'yermo',
} = {}) {
  const terrainTypeId = await resolveTerrainTypeId(tileType);
  const created = await withTransaction(async () => {
    let n = 0;
    for (let x = originX; x < originX + width; x++) {
      for (let y = originY; y < originY + height; y++) {
        const info = await execute(SQL.insertTileIfMissing, [x, y, name, terrainTypeId, '']);
        if (info.changes > 0) n++;
      }
    }
    return n;
  });
  if (created > 0) {
    await regenerateTemperaturesForRange(originX, originY, originX + width - 1, originY + height - 1);
    logger.info(
      `[MapService] 🌱 Grid inicial sembrado: ${created} casilla(s) nueva(s) ` +
      `en (${originX},${originY})–(${originX + width - 1},${originY + height - 1}).`
    );
  }
  return created;
}

export async function upsertTileTerrain(x, y, tileType, name) {
  if (x < 0 || y < 0) {
    throw new Error(`No se pueden crear casillas en coordenadas negativas — (${x}, ${y}) queda fuera del mapa.`);
  }
  const terrainTypeId = await resolveTerrainTypeId(tileType);
  await execute(SQL.upsertTileTerrain, [x, y, name, terrainTypeId]);
}

export async function updateTile(x, y, updates = {}) {
  const fields = [];
  const values = [];

  if (updates.name          != null) { fields.push('name = ?');          values.push(updates.name); }
  if (updates.terrainType   != null) { fields.push('terrain_type_id = ?'); values.push(await resolveTerrainTypeId(updates.terrainType)); }
  if (updates.description   != null) { fields.push('description = ?');  values.push(updates.description); }
  if (updates.resource_type !== undefined) {
    const resourceType = updates.resource_type ? updates.resource_type.trim().toLowerCase() : null;
    fields.push('resource_type = ?'); values.push(resourceType || null);
  }

  if (updates.effectType !== undefined) {
    const effectType = updates.effectType || null;
    if (effectType && !(await getEffectType(effectType))) {
      throw new Error(`Tipo de efecto inválido: "${effectType}". Usa \`/effect list\` para ver los disponibles.`);
    }
    fields.push('effect_type = ?'); values.push(effectType);
  }

  if (updates.zone !== undefined) {
    const zoneName = updates.zone ? updates.zone.toLowerCase().trim() : null;
    let zoneId = null;
    if (zoneName) {
      const zone = await queryOne(SQL.getZoneByName, [zoneName]);
      if (!zone) throw new Error(`No existe ninguna zona llamada \`${zoneName}\`. Usa \`/zona listar\` para ver las disponibles.`);
      zoneId = zone.id;
    }
    fields.push('zone_id = ?'); values.push(zoneId);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar (nombre, tipo o descripción).');
  }

  values.push(x, y);

  const result = await execute(
    `UPDATE ${T.map_tiles} SET ${fields.join(', ')} WHERE coord_x = ? AND coord_y = ?`,
    values
  );

  if (result.changes === 0) {
    throw new Error(`No existe ninguna casilla en **(${x}, ${y})**. Créala primero con \`/map create\`.`);
  }

  logger.info(`[MapService] Casilla (${x},${y}) actualizada: ${fields.join(', ')}`);
  return queryOne(SQL.getTileWithOwner, [x, y]);
}

export async function setTileOwner(x, y, discordId = null) {
  await resolveTileId(x, y);

  if (discordId) {
    const playerRow = await queryOne(SQL.getPlayerIdByDiscordId, [discordId]);
    if (!playerRow) {
      throw new Error(`El jugador con Discord ID "${discordId}" no está registrado en el juego.`);
    }
    await execute(SQL.setOwnerToPlayer, [playerRow.id, x, y]);
    logger.info(`[MapService] Propietario de (${x},${y}) → ${discordId}`);
  } else {
    await execute(SQL.clearOwner, [x, y]);
    logger.info(`[MapService] Propietario de (${x},${y}) eliminado (territorio neutral)`);
  }

  return queryOne(SQL.getTileWithOwner, [x, y]);
}

export async function addResourceGenerator(x, y, itemName, generationRate) {
  const tileId = await resolveTileId(x, y);
  const item   = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem "${itemName}" no existe en el catálogo.`);

  await execute(SQL.upsertGenerator, [tileId, item.id, generationRate]);

  logger.info(
    `[MapService] Generador añadido: ${item.display_name} × ${generationRate}/día @ (${x},${y})`
  );
  return { tileId, item, generationRate };
}

export async function removeResourceGenerator(x, y, itemName) {
  const tileId = await resolveTileId(x, y);
  const item   = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem "${itemName}" no existe en el catálogo.`);

  const result = await execute(SQL.deleteGenerator, [tileId, item.id]);
  logger.info(`[MapService] Generador eliminado: ${item.display_name} @ (${x},${y})`);
  return result.changes;
}

export async function placeConstructionInstance(x, y, constructionType, builtByDiscordId = null) {
  const tileId = await resolveTileId(x, y);

  let builtByPlayerId = null;
  if (builtByDiscordId) {
    const p = await queryOne(SQL.getPlayerIdByDiscordId, [builtByDiscordId]);
    builtByPlayerId = p?.id ?? null;
  }

  const result = await execute(SQL.insertConstructionInstance, [
    tileId, constructionType.display_name, constructionType.id,
    constructionType.unlocks_recipe_id, builtByPlayerId,
    constructionType.max_health ?? 10
  ]);

  if (constructionType.grants_resource_item_id && constructionType.grants_resource_rate) {
    const item = await queryOne(SQL.getItemNameById, [constructionType.grants_resource_item_id]);
    if (item) {
      await addResourceGenerator(x, y, item.name, constructionType.grants_resource_rate);
    }
  }

  logger.info(`[MapService] Construcción plantada: "${constructionType.display_name}" (${constructionType.name}) @ (${x},${y})`);
  return queryOne(SQL.getConstructionById, [result.lastInsertRowid]);
}

export async function getConstructionByTypeAndTile(x, y, constructionTypeId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) return null;
  return (await queryOne(SQL.getConstructionByTypeAndTile, [tile.id, constructionTypeId])) ?? null;
}

export async function getConstructionsByTypeAndTile(x, y, constructionTypeId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) return [];
  return query(SQL.getConstructionsByTypeAndTile, [tile.id, constructionTypeId]);
}

export async function countConstructionsAtTile(x, y, constructionTypeId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) return { total: 0, ofType: 0 };
  const [totalRow, ofTypeRow] = await Promise.all([
    queryOne(SQL.countConstructionsAtTile, [tile.id]),
    queryOne(SQL.countConstructionsOfTypeAtTile, [tile.id, constructionTypeId]),
  ]);
  return { total: totalRow.total, ofType: ofTypeRow.total };
}

export function pickConstruction(rows, { x, y, typeLabel, constructionId = null }) {
  if (rows.length === 0) {
    throw new UserFacingError(`No hay ninguna construcción de tipo **${typeLabel}** en (${x}, ${y}).`);
  }

  if (constructionId != null) {
    const picked = rows.find(c => c.id === constructionId);
    if (!picked) {
      throw new UserFacingError(
        `La construcción **#${constructionId}** no es una **${typeLabel}** de (${x}, ${y}). ` +
        `Las que hay ahí son: ${rows.map(c => `#${c.id}`).join(', ')}.`
      );
    }
    return picked;
  }

  if (rows.length > 1) {
    const list = rows
      .map(c => {
        const max = c.ct_max_health ?? 10;
        const hp  = c.current_health ?? max;
        return `**#${c.id}** — ${hp <= 0 ? '🏚️ en ruinas' : `❤️ ${hp}/${max}`}`;
      })
      .join('\n');
    throw new UserFacingError(
      `Hay **${rows.length}** construcciones de tipo **${typeLabel}** en (${x}, ${y}). ` +
      `Indica cuál con la opción \`id\`:\n${list}`
    );
  }

  return rows[0];
}

export async function resolveConstructionAtTile(x, y, constructionType, constructionId = null) {
  return pickConstruction(
    await getConstructionsByTypeAndTile(x, y, constructionType.id),
    { x, y, typeLabel: constructionType.display_name, constructionId }
  );
}

export async function removeConstruction(constructionId, actor = null, playerPos = null) {
  const construction = await queryOne(SQL.getConstructionById, [constructionId]);
  if (!construction) {
    throw new Error(`No existe ninguna construcción con ID **${constructionId}**.`);
  }

  if (actor) {
    if (playerPos && (playerPos.x !== construction.coord_x || playerPos.y !== construction.coord_y)) {
      throw new UserFacingError(
        `Tienes que estar físicamente en esa casilla para esto. ` +
        `Tu posición: (${playerPos.x}, ${playerPos.y}) · Casilla de la construcción: (${construction.coord_x}, ${construction.coord_y}).`
      );
    }
    const scope = { type: 'construction', id: constructionId, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
    const result = await resolvePermission(
      { discordId: actor.discordId, isRolepriest: Boolean(actor.isRolepriest) },
      scope, 'construction.destroy', construction.destroy_policy ?? 'any'
    );
    if (!result.allowed) {
      throw new UserFacingError(`No puedes destruir **${construction.name}** — ${result.reason}.`);
    }
  }

  if (construction.granted_item_name) {
    try {
      await removeResourceGenerator(construction.coord_x, construction.coord_y, construction.granted_item_name);
    } catch (err) {
      logger.warn(`[MapService] No se pudo desactivar el generador de la construcción #${constructionId} al eliminarla: ${err.message}`);
    }
  }

  await execute(SQL.deleteConstruction, [constructionId]);
  logger.info(`[MapService] Construcción eliminada: ID ${constructionId} "${construction.name}"`);
  return construction;
}

export async function getConstructionById(id) {
  return (await queryOne(SQL.getConstructionById, [id])) ?? null;
}

export async function updateConstructionInstance(id, { currentHealth, fuelLevel, durability } = {}) {
  const construction = await queryOne(SQL.getConstructionById, [id]);
  if (!construction) {
    throw new Error(`No existe ninguna construcción con ID **${id}**.`);
  }

  const maxHealth = construction.ct_max_health ?? 10;
  const maxDurability = construction.ct_max_durability ?? 100;
  const newDurability = durability != null
    ? Math.max(0, Math.min(maxDurability, durability))
    : construction.durability;

  const fuelCapacity = construction.ct_fuel_capacity;

  const newHealth = currentHealth != null
    ? Math.max(0, Math.min(maxHealth, currentHealth))
    : construction.current_health;
  const newFuel = fuelLevel != null
    ? (fuelCapacity != null ? Math.max(0, Math.min(fuelCapacity, fuelLevel)) : Math.max(0, fuelLevel))
    : construction.fuel_level;

  const wasRuined = isConstructionRuined(construction);
  const nowRuined = (newHealth ?? maxHealth) <= 0;

  await execute(SQL.updateConstructionInstance, [newHealth, newFuel, newDurability, id]);

  if (wasRuined && !nowRuined && construction.granted_item_name && construction.granted_resource_rate) {
    try {
      await addResourceGenerator(construction.coord_x, construction.coord_y, construction.granted_item_name, construction.granted_resource_rate);
    } catch (err) {
      logger.warn(`[MapService] No se pudo reactivar el generador de la construcción #${id} al editar su vida a mano: ${err.message}`);
    }
  }

  logger.info(`[MapService] Construcción #${id} "${construction.name}" editada a mano: vida=${newHealth}, combustible=${newFuel}, durabilidad=${newDurability}`);
  return queryOne(SQL.getConstructionById, [id]);
}

export async function damageConstruction(constructionId, amount) {
  return withTransaction(async () => {
    const locked = await queryOne(SQL.getConstructionHealthForUpdate, [constructionId]);
    if (!locked) {
      throw new Error(`No existe ninguna construcción con ID **${constructionId}**.`);
    }
    const construction = await queryOne(SQL.getConstructionById, [constructionId]);

    const healthBefore = locked.current_health ?? 10;
    const healthAfter  = Math.max(0, healthBefore - amount);
    const ruinedNow     = healthBefore > 0 && healthAfter <= 0;

    await execute(SQL.setConstructionHealth, [healthAfter, constructionId]);

    if (ruinedNow && construction.granted_item_name) {
      try {
        await removeResourceGenerator(construction.coord_x, construction.coord_y, construction.granted_item_name);
      } catch (err) {
        logger.warn(`[MapService] No se pudo desactivar el generador de la construcción #${constructionId} al arruinarse: ${err.message}`);
      }
    }

    logger.info(
      `[MapService] Construcción #${constructionId} "${construction.name}" dañada: ` +
      `${healthBefore} → ${healthAfter}${ruinedNow ? ' (EN RUINAS)' : ''}`
    );

    return { construction, healthBefore, healthAfter, ruinedNow };
  });
}

export async function repairConstructionHealth(constructionId) {
  const construction = await queryOne(SQL.getConstructionById, [constructionId]);
  if (!construction) {
    throw new Error(`No existe ninguna construcción con ID **${constructionId}**.`);
  }

  const maxHealth = construction.ct_max_health ?? 10;
  await execute(SQL.setConstructionHealth, [maxHealth, constructionId]);

  if (construction.granted_item_name && construction.granted_resource_rate) {
    try {
      await addResourceGenerator(construction.coord_x, construction.coord_y, construction.granted_item_name, construction.granted_resource_rate);
    } catch (err) {
      logger.warn(`[MapService] No se pudo reactivar el generador de la construcción #${constructionId} al repararla: ${err.message}`);
    }
  }

  logger.info(`[MapService] Construcción #${constructionId} "${construction.name}" reparada: ${construction.current_health ?? 0} → ${maxHealth}`);

  return queryOne(SQL.getConstructionById, [constructionId]);
}

export async function updatePlayerPosition(discordId, x, y) {
  if (x < 0 || y < 0) {
    throw new Error(`No se puede mover a coordenadas negativas — (${x}, ${y}) queda fuera del mapa.`);
  }

  const before = await queryOne(SQL.getPlayerPosByDiscordId, [discordId]);
  const result = await execute(SQL.updatePlayerPos, [x, y, discordId]);
  if (result.changes > 0) {
    logger.debug(`[MapService] Jugador ${discordId} → (${x},${y})`);

    if (before && (before.coord_x !== x || before.coord_y !== y)) {
      const oldTile = await getTile(before.coord_x, before.coord_y);
      if (oldTile?.effect_type) {
        await removeTileSourcedEffect(discordId, oldTile.id);
      }

      const newTile = await getTile(x, y);
      if (newTile?.effect_type) {
        const meta = await getEffectType(newTile.effect_type);
        if (meta) {
          await applyEffect(discordId, newTile.effect_type, meta.laburo_modifier, meta.hp_delta_per_day, null, newTile.id);
        } else {
          logger.warn(`[MapService] La casilla (${x},${y}) tiene effect_type="${newTile.effect_type}" pero ese tipo ya no existe en el catálogo.`);
        }
      }
    }
  }
  return result.changes;
}

export async function tileHasLandingSite(x, y) {
  const { cnt } = await queryOne(SQL.countLandingSitesAtTile, [x, y]);
  return cnt > 0;
}

export async function getBestTravelCostMultiplierAtTile(x, y) {
  const { best } = await queryOne(SQL.getBestTravelCostMultiplierAtTile, [x, y]);
  return best ?? 1;
}

export async function getConstructionsInRadius(x, y, radius) {
  const r = Math.max(0, Math.trunc(radius));
  const rows = await query(SQL.getConstructionsInRadius, [x - r, x + r, y - r, y + r]);
  return rows
    .map(c => ({ ...c, distance: Math.max(Math.abs(c.coord_x - x), Math.abs(c.coord_y - y)) }))
    .sort((a, b) => a.distance - b.distance);
}
