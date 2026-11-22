import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import { toSqlDatetime } from '../utils/sqlDatetime.js';
import logger from '../utils/logger.js';
import { getTile, updatePlayerPosition, getBestTravelCostMultiplierAtTile, getMapMaxCoordinate, tileHasLandingSite } from './mapService.js';
import { getTerrainTypeById } from './terrainTypeService.js';
import { hasVehicleOfCategory, getBestVehicleSpeedMultiplier } from './vehicleService.js';
import { getActiveMount, moveNpcToTile, countBlockingEncounters, releaseEncountersAwayFromPlayer } from './npcService.js';
import { getSetting } from './settingsService.js';
import { UserFacingError } from '../utils/errors.js';
import { handleBorderCrossing } from './factionNotificationService.js';
import { notifyModmailChannel } from './modmailService.js';
import { logAction } from './auditLogService.js';
import { sendPlayerAlert } from './playerAlertService.js';

const TICK_HOURS = 1 / 3;

const SQL = {
  startTravel: `
    UPDATE ${T.players} SET travel_dest_x=?, travel_dest_y=?, travel_next_tick_at=?, travel_speed_multiplier=?,
      travel_paused_by_npc_id=NULL
    WHERE discord_id=?
  `,
  clearTravel: `
    UPDATE ${T.players} SET travel_dest_x=NULL, travel_dest_y=NULL, travel_next_tick_at=NULL, travel_speed_multiplier=NULL,
      travel_paused_by_npc_id=NULL
    WHERE discord_id=?
  `,
  releasePause: `
    UPDATE ${T.players}
    SET travel_paused_by_npc_id = NULL,
        travel_next_tick_at = IF(travel_dest_x IS NULL, travel_next_tick_at, ?)
    WHERE discord_id = ? AND travel_paused_by_npc_id IS NOT NULL
  `,
  clearOrphanPauses: `
    UPDATE ${T.players} p
    SET p.travel_paused_by_npc_id = NULL
    WHERE p.travel_paused_by_npc_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ${T.npcs} n
        JOIN ${T.map_tiles} t  ON n.tile_id = t.id
        JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
        LEFT JOIN ${T.npc_group_types} gt ON n.spawned_from_group_type_id = gt.id
        WHERE n.encountered_by_player_id = p.id AND n.is_wild = 1
          AND COALESCE(gt.is_aggressive, nt.is_aggressive) = 1
          AND t.coord_x = p.coord_x AND t.coord_y = p.coord_y
      )
  `,
  setNextTick: `UPDATE ${T.players} SET travel_next_tick_at=? WHERE discord_id=?`,
  getByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id=?`,
  getDueTravelers: `
    SELECT * FROM ${T.players}
    WHERE travel_dest_x IS NOT NULL AND travel_next_tick_at <= NOW() AND travel_paused_by_npc_id IS NULL
      AND is_alive = 1 AND character_created_at IS NOT NULL
  `,
};

export function planPath(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  while (true) {
    points.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return points;
}

async function canEnterTile(discordId, tile) {
  if (!tile) return { ok: true };
  const terrain = await getTerrainTypeById(tile.terrain_type_id);
  if (!terrain?.requires_vehicle_category) return { ok: true };
  if ((await hasVehicleOfCategory(discordId, terrain.requires_vehicle_category)) || (await hasVehicleOfCategory(discordId, 'aereo'))) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `necesitas un vehículo ${terrain.requires_vehicle_category} (o uno aéreo) para pasar por (${tile.coord_x},${tile.coord_y})`,
  };
}

export async function findBlockedStep(discordId, path) {
  for (let i = 1; i < path.length; i++) {
    const { x, y } = path[i];
    const check = await canEnterTile(discordId, await getTile(x, y));
    if (!check.ok) return { x, y, reason: check.reason };
  }
  return null;
}

export async function requiredCategoriesAlongPath(path) {
  const categories = new Set();
  for (let i = 1; i < path.length; i++) {
    const { x, y } = path[i];
    const tile = await getTile(x, y);
    if (!tile) continue;
    const terrain = await getTerrainTypeById(tile.terrain_type_id);
    if (terrain?.requires_vehicle_category) categories.add(terrain.requires_vehicle_category);
  }
  return [...categories];
}

async function getTileMovementCost(x, y) {
  const tile = await getTile(x, y);
  if (!tile) return 1;
  const terrain = await getTerrainTypeById(tile.terrain_type_id);
  const baseCost = terrain?.movement_cost ?? 1;
  return baseCost * (await getBestTravelCostMultiplierAtTile(x, y));
}

export async function computePathCost(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += await getTileMovementCost(path[i].x, path[i].y);
  return total;
}

function nextTickTimestamp() {
  return toSqlDatetime(new Date(Date.now() + TICK_HOURS * 3_600_000));
}

async function _notifyTravelUpdate(client, player, message) {
  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (user) await user.send(message).catch(() => {});

  if (player.modmail_channel_id) {
    await notifyModmailChannel(client, player.modmail_channel_id, message);
  }
}

export async function startTravel(discordId, destX, destY, speedMultiplier) {
  await execute(SQL.startTravel, [destX, destY, nextTickTimestamp(), speedMultiplier, discordId]);
}

export async function releaseEncounterPause(discordId) {
  const info = await execute(SQL.releasePause, [nextTickTimestamp(), discordId]);
  return info.changes > 0;
}

export async function clearOrphanEncounterPauses() {
  const info = await execute(SQL.clearOrphanPauses, []);
  if (info.changes > 0) {
    logger.info(`[Travel] ${info.changes} viaje(s) liberado(s): ya no queda ningún encuentro que los retenga.`);
  }
  return info.changes;
}

export async function isHeldByEncounter(player) {
  if (!player) return false;
  await releaseEncountersAwayFromPlayer(player.id);
  if (await countBlockingEncounters(player.id) > 0) return true;
  if (player.travel_paused_by_npc_id != null) await releaseEncounterPause(player.discord_id);
  return false;
}

export async function beginTravel(discordId, destX, destY) {
  if ((await getSetting('move_freedom', 'true')) === 'false') {
    throw new UserFacingError('🔒 El movimiento libre está desactivado ahora mismo. Un Rolepriest debe reposicionarte con `/tp`.');
  }

  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!player.is_alive) throw new UserFacingError('Tu personaje está muerto y no puede moverse.');
  if (await isHeldByEncounter(player)) {
    throw new UserFacingError(
      'Hay un encuentro sin resolver que te retiene en esta casilla — atácalo, huye o ríndete (los botones del encuentro, `/attack` o `/huir`) antes de viajar.'
    );
  }
  if (destX === player.coord_x && destY === player.coord_y) throw new UserFacingError('Ya estás en esa casilla.');

  const maxCoord = await getMapMaxCoordinate();
  if (destX > maxCoord || destY > maxCoord) {
    throw new UserFacingError(`(${destX}, ${destY}) está fuera del mapa oficial (máximo ${maxCoord}) — un Rolepriest puede llevarte más allá con \`/tp\`.`);
  }

  const destTileRaw = await getTile(destX, destY);
  if (!destTileRaw) {
    throw new UserFacingError(
      `La casilla **(${destX}, ${destY})** no existe todavía — es territorio sin crear. ` +
      'Solo puedes viajar hacia casillas ya registradas en el mapa.'
    );
  }

  const destTerrain = await getTerrainTypeById(destTileRaw.terrain_type_id);
  if (destTerrain?.requires_vehicle_category && (await hasVehicleOfCategory(discordId, 'aereo')) && !(await tileHasLandingSite(destX, destY))) {
    throw new UserFacingError(`Para volar hasta **${destTerrain.display_name}** necesitas un edificio de aterrizaje en el destino — la casilla (${destX}, ${destY}) no tiene ninguno.`);
  }

  const path = planPath(player.coord_x, player.coord_y, destX, destY);
  const blocked = await findBlockedStep(discordId, path);
  if (blocked) throw new UserFacingError(`No puedes completar ese viaje: ${blocked.reason}.`);

  const relevantCategories = await requiredCategoriesAlongPath(path);
  const speedMultiplier = await getBestVehicleSpeedMultiplier(discordId, relevantCategories);
  const steps = path.length - 1;
  const etaHours = Math.ceil((await computePathCost(path)) / speedMultiplier);
  const redirected = (await getTravelStatus(discordId)) !== null;

  await startTravel(discordId, destX, destY, speedMultiplier);

  return {
    from: { x: player.coord_x, y: player.coord_y },
    to: { x: destX, y: destY },
    steps, speedMultiplier, etaHours, redirected,
  };
}

export async function notifyTravelStarted(client, discordId, trip) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) return;

  const etaText = trip.etaHours === 1 ? '~1 hora' : `~${trip.etaHours} horas`;
  const verb = trip.redirected ? 'Redirigiste tu viaje hacia' : 'Empezaste un viaje hacia';
  const message = `🧭 ${verb} **(${trip.to.x}, ${trip.to.y})** — ${trip.steps} casilla(s), llegada estimada en ${etaText}.`;

  await _notifyTravelUpdate(client, player, message);
}

export async function cancelTravel(discordId) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (player?.travel_dest_x == null) {
    if (player?.travel_paused_by_npc_id != null) await releaseEncounterPause(discordId);
    return false;
  }
  await execute(SQL.clearTravel, [discordId]);
  return true;
}

export async function getTravelStatus(discordId) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (player?.travel_dest_x == null) return null;

  const path = planPath(player.coord_x, player.coord_y, player.travel_dest_x, player.travel_dest_y);
  const speedMultiplier = Math.max(player.travel_speed_multiplier ?? 1, 0.01);
  const etaHours = Math.ceil((await computePathCost(path)) / speedMultiplier);
  const paused = player.travel_paused_by_npc_id != null;

  return {
    destX: player.travel_dest_x, destY: player.travel_dest_y,
    speedMultiplier: player.travel_speed_multiplier, nextTickAt: player.travel_next_tick_at,
    etaHours, paused,
    arrivalAt: paused ? null : new Date(Date.now() + etaHours * 3_600_000).toISOString(),
  };
}

async function _advanceOnePlayer(client, player) {
  const { rollAndHandleEncounter } = await import('./npcEncounterService.js');

  const path = planPath(player.coord_x, player.coord_y, player.travel_dest_x, player.travel_dest_y);
  let budget = Math.max(player.travel_speed_multiplier ?? 1, 0.01);

  let prevTile = await getTile(player.coord_x, player.coord_y);
  let finalX = player.coord_x, finalY = player.coord_y;
  let stoppedReason = null;
  let pausedByEncounter = false;
  let taken = 0;

  const activeMount = await getActiveMount(player.id);

  for (let i = 1; i < path.length && budget > 0; i++) {
    const { x, y } = path[i];
    const tile = await getTile(x, y);
    const check = await canEnterTile(player.discord_id, tile);
    if (!check.ok) { stoppedReason = check.reason; break; }

    await updatePlayerPosition(player.discord_id, x, y);
    if (activeMount) await moveNpcToTile(activeMount.id, tile.id);

    logAction({
      source: 'discord', actorDiscordId: player.discord_id, actorUsername: player.username,
      action: 'tile.player_move', target: `(${x},${y})`,
    });
    if (client) {
      try { await handleBorderCrossing(client, player, prevTile, tile); }
      catch (err) { logger.warn(`[Travel] No se pudo notificar cruce de frontera de ${player.username}: ${err.message}`); }

      const isFinalTile = x === player.travel_dest_x && y === player.travel_dest_y;
      if (!isFinalTile) {
        await sendPlayerAlert(client, player.discord_id, 'travelStep', `🧭 Avanzaste a **(${x}, ${y})**.`);
      }
    }
    prevTile = tile;
    finalX = x; finalY = y;
    budget -= await getTileMovementCost(x, y);
    taken++;

    const encounter = await rollAndHandleEncounter(client, { ...player, coord_x: x, coord_y: y });
    if (encounter?.paused) { pausedByEncounter = true; break; }
  }

  const arrived = finalX === player.travel_dest_x && finalY === player.travel_dest_y;
  if (pausedByEncounter) {
  } else if (arrived || stoppedReason) {
    await execute(SQL.clearTravel, [player.discord_id]);
    if (client) {
      const message = arrived
        ? `🏁 Has llegado a **(${finalX}, ${finalY})**.`
        : `🚧 Tu viaje se ha detenido en **(${finalX}, ${finalY})**: ${stoppedReason}. Usa \`/move\` para intentarlo de nuevo cuando puedas.`;

      try { await _notifyTravelUpdate(client, player, message); }
      catch (err) { logger.warn(`[Travel] No se pudo notificar el fin del viaje de ${player.username}: ${err.message}`); }
    }
  } else {
    await execute(SQL.setNextTick, [nextTickTimestamp(), player.discord_id]);
  }

  return { discordId: player.discord_id, username: player.username, x: finalX, y: finalY, arrived, stoppedReason, pausedByEncounter, stepsTaken: taken };
}

export async function processTravelTicks(client = null) {
  await clearOrphanEncounterPauses();
  const due = await query(SQL.getDueTravelers);
  const results = [];
  for (const player of due) {
    try {
      results.push(await _advanceOnePlayer(client, player));
    } catch (err) {
      logger.error(`[Travel] Error avanzando el viaje de ${player.username}: ${err.message}`);
      console.error(err);
    }
  }
  return results;
}
