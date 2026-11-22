import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import { toSqlDatetime } from '../utils/sqlDatetime.js';
import logger from '../utils/logger.js';
import { config, MAX_HP, MAX_HUNGER } from '../utils/permissions.js';
import { round2 } from '../utils/math.js';
import { getEffectType } from './effectTypesService.js';
import { getSetting, setSetting } from './settingsService.js';

export const DEFAULT_LABURO = config.game?.startingLaburo ?? 1.0;

const DEFAULT_SPAWN_X = 0;
const DEFAULT_SPAWN_Y = 0;

const SQL = {
  findByDiscordId: `
    SELECT * FROM ${T.players} WHERE discord_id = ?
  `,

  getFactionById: `SELECT display_name, emoji FROM ${T.factions} WHERE id = ?`,

  listRegistered: `
    SELECT discord_id, username, character_name
    FROM ${T.players}
    WHERE character_created_at IS NOT NULL
  `,

  search: `
    SELECT discord_id, username, character_name, is_alive, hp
    FROM ${T.players}
    WHERE character_created_at IS NOT NULL
      AND (username LIKE ? OR discord_id LIKE ? OR character_name LIKE ?)
    ORDER BY username ASC
    LIMIT ? OFFSET ?
  `,

  countSearch: `
    SELECT COUNT(*) AS total
    FROM ${T.players}
    WHERE character_created_at IS NOT NULL
      AND (username LIKE ? OR discord_id LIKE ? OR character_name LIKE ?)
  `,

  getPlayersInRadius: `
    SELECT discord_id, username, character_name, is_alive, hp, coord_x, coord_y, avatar_filename
    FROM ${T.players}
    WHERE coord_x BETWEEN ? AND ?
      AND coord_y BETWEEN ? AND ?
      AND is_alive = 1
      AND character_created_at IS NOT NULL
      AND discord_id != ?
  `,

  getPlayersAtTile: `
    SELECT discord_id, username, character_name, is_alive, hp
    FROM ${T.players}
    WHERE coord_x = ? AND coord_y = ? AND character_created_at IS NOT NULL
    ORDER BY is_alive DESC, username ASC
  `,

  insert: `
    INSERT INTO ${T.players} (discord_id, username, hp, hunger, laburo_base, coord_x, coord_y)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  updateUsername: `
    UPDATE ${T.players}
    SET username   = ?,
        updated_at = NOW()
    WHERE discord_id = ?
  `,

  updateStatsAll: `
    UPDATE ${T.players}
    SET hp          = ?,
        hunger      = ?,
        laburo_base = ?,
        updated_at  = NOW()
    WHERE discord_id = ?
  `,

  getActiveEffects: `
    SELECT *
    FROM ${T.player_effects}
    WHERE player_id = ?
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at ASC
  `,

  getActiveEffectModifiers: `
    SELECT et.name, et.label, et.emoji, et.laburo_modifier, et.blocks_laburo
    FROM ${T.player_effects} pe
    JOIN ${T.players} p        ON pe.player_id = p.id
    JOIN ${T.effect_types} et  ON pe.effect_type = et.name
    WHERE p.discord_id = ?
      AND (pe.expires_at IS NULL OR pe.expires_at > NOW())
  `,

  insertEffect: `
    INSERT INTO ${T.player_effects}
      (player_id, effect_type, laburo_modifier, hp_delta_per_day, expires_at, source_tile_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `,

  getEffectById: `
    SELECT * FROM ${T.player_effects} WHERE id = ?
  `,

  removeEffectsBySourceTile: `
    DELETE FROM ${T.player_effects}
    WHERE player_id = ? AND source_tile_id = ?
  `,

  removeEffectsByType: `
    DELETE FROM ${T.player_effects}
    WHERE player_id = ? AND effect_type = ?
  `,

  setAvatar: `
    UPDATE ${T.players}
    SET avatar_filename = ?,
        updated_at      = NOW()
    WHERE discord_id = ?
  `,

  setImmortal: `
    UPDATE ${T.players}
    SET is_immortal = ?,
        updated_at  = NOW()
    WHERE discord_id = ?
  `,

  markDead: `
    UPDATE ${T.players}
    SET is_alive   = 0,
        hp         = 0,
        died_at    = NOW(),
        updated_at = NOW()
    WHERE discord_id = ?
  `,

  revive: `
    UPDATE ${T.players}
    SET is_alive                = 1,
        hp                      = ?,
        hunger                  = ?,
        died_at                 = NULL,
        travel_paused_by_npc_id = NULL,
        updated_at              = NOW()
    WHERE discord_id = ?
  `,

  findById: `
    SELECT * FROM ${T.players} WHERE id = ?
  `,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export async function getOrCreatePlayer(discordId, username) {
  let player = await queryOne(SQL.findByDiscordId, [discordId]);

  if (!player) {
    const spawn = await getSpawnCoords();
    await execute(SQL.insert, [discordId, username, MAX_HP, MAX_HUNGER, DEFAULT_LABURO, spawn.x, spawn.y]);
    player = await queryOne(SQL.findByDiscordId, [discordId]);
    logger.info(`[PlayerService] Nuevo jugador registrado: ${username} (${discordId}) @ (${spawn.x},${spawn.y})`);
  } else if (player.username !== username) {
    await execute(SQL.updateUsername, [username, discordId]);
    player = await queryOne(SQL.findByDiscordId, [discordId]);
    logger.debug(`[PlayerService] Username sincronizado: ${discordId} → "${username}"`);
  }

  return player;
}

export async function getPlayerStats(discordId, username) {
  const player = username
    ? await getOrCreatePlayer(discordId, username)
    : await queryOne(SQL.findByDiscordId, [discordId]);

  if (!player) return null;

  const effects = await query(SQL.getActiveEffects, [player.id]);

  const activeLaburoModifier = round2(effects.reduce((acc, e) => acc + (e.laburo_modifier ?? 0), 0));

  const faction = player.faction_id ? await queryOne(SQL.getFactionById, [player.faction_id]) : null;

  return {
    ...player,
    faction_display_name: faction?.display_name ?? null,
    faction_emoji:         faction?.emoji ?? null,
    effects,
    activeLaburoModifier,
  };
}

export async function updateStats(discordId, { hp, hunger, laburo_base } = {}) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  const newHp     = hp         !== undefined ? clamp(hp, 0, MAX_HP)         : player.hp;
  const newHunger = hunger     !== undefined ? clamp(hunger, 0, MAX_HUNGER) : player.hunger;
  const newLaburo = laburo_base !== undefined ? Math.max(0, laburo_base)     : player.laburo_base;

  await execute(SQL.updateStatsAll, [newHp, newHunger, newLaburo, discordId]);

  logger.debug(
    `[PlayerService] Stats actualizados: ${player.username} ` +
    `HP=${newHp} Hambre=${newHunger} Laburo=${newLaburo}`
  );

  return queryOne(SQL.findByDiscordId, [discordId]);
}

export async function applyEffect(discordId, effectType, laburoModifier = 0, hpDeltaPerDay = 0, durationHours = null, sourceTileId = null) {
  if (!(await getEffectType(effectType))) {
    throw new Error(
      `Tipo de efecto inválido: "${effectType}". Usa \`/effect list\` para ver los tipos disponibles.`
    );
  }

  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  const expiresAt = durationHours != null
    ? toSqlDatetime(new Date(Date.now() + durationHours * 3_600_000))
    : null;

  const result = await execute(SQL.insertEffect, [
    player.id,
    effectType,
    laburoModifier,
    hpDeltaPerDay,
    expiresAt,
    sourceTileId
  ]);

  logger.info(
    `[PlayerService] Efecto "${effectType}" aplicado a ${player.username} ` +
    `(laburo: ${laburoModifier >= 0 ? '+' : ''}${laburoModifier}, ` +
    `hp/día: ${hpDeltaPerDay >= 0 ? '+' : ''}${hpDeltaPerDay}, ` +
    `vence: ${expiresAt ?? 'permanente'})`
  );

  return queryOne(SQL.getEffectById, [result.lastInsertRowid]);
}

export async function removeEffect(discordId, effectType) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  const result = await execute(SQL.removeEffectsByType, [player.id, effectType]);
  logger.debug(`[PlayerService] Efecto "${effectType}" eliminado de ${player.username} (${result.changes} fila/s)`);
  return result.changes;
}

export async function removeTileSourcedEffect(discordId, tileId) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) return 0;

  const result = await execute(SQL.removeEffectsBySourceTile, [player.id, tileId]);
  if (result.changes > 0) {
    logger.debug(`[PlayerService] Efecto de la casilla ${tileId} retirado de ${player.username} (${result.changes} fila/s)`);
  }
  return result.changes;
}

export async function getPlayersAtTile(x, y) {
  return query(SQL.getPlayersAtTile, [x, y]);
}

export async function getPlayerAtTileByCharacterName(x, y, characterName) {
  const needle = characterName.trim().toLowerCase();
  const here = await getPlayersAtTile(x, y);
  return here.find(p => p.character_name?.toLowerCase() === needle) ?? null;
}

export async function getPlayersInRadius(x, y, radius, excludeDiscordId) {
  const r = Math.max(0, Math.trunc(radius));
  const rows = await query(SQL.getPlayersInRadius, [x - r, x + r, y - r, y + r, excludeDiscordId]);
  return rows
    .map(p => ({ ...p, distance: Math.max(Math.abs(p.coord_x - x), Math.abs(p.coord_y - y)) }))
    .sort((a, b) => a.distance - b.distance);
}

export async function setAvatarFilename(discordId, relativeFilename) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  await execute(SQL.setAvatar, [relativeFilename, discordId]);
  logger.info(`[PlayerService] Avatar actualizado: ${player.username} → ${relativeFilename}`);
  return queryOne(SQL.findByDiscordId, [discordId]);
}

export async function setImmortal(discordId, isImmortal) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);

  await execute(SQL.setImmortal, [isImmortal ? 1 : 0, discordId]);
  logger.info(`[PlayerService] Inmortalidad de ${player.username} → ${isImmortal ? 'ACTIVADA' : 'desactivada'}`);
  return queryOne(SQL.findByDiscordId, [discordId]);
}

export async function killPlayer(discordId) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (!player.is_alive) throw new Error(`${player.username} ya estaba marcado como muerto.`);

  await execute(SQL.markDead, [discordId]);
  logger.info(`[PlayerService] 💀 Jugador marcado como muerto: ${player.username} (${discordId})`);

  return queryOne(SQL.findByDiscordId, [discordId]);
}

export async function revivePlayer(discordId, reviveHp = MAX_HP, reviveHunger = MAX_HUNGER) {
  const player = await queryOne(SQL.findByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (player.is_alive) throw new Error(`${player.username} ya está vivo.`);

  const clampedHp     = clamp(reviveHp, 1, MAX_HP);
  const clampedHunger = clamp(reviveHunger, 0, MAX_HUNGER);
  await execute(SQL.revive, [clampedHp, clampedHunger, discordId]);
  logger.info(
    `[PlayerService] ✨ Jugador revivido: ${player.username} (${discordId}) ` +
    `con ${clampedHp} HP / ${clampedHunger} Hambre`
  );

  return queryOne(SQL.findByDiscordId, [discordId]);
}

export async function findPlayerById(id) {
  return (await queryOne(SQL.findById, [id])) ?? null;
}

export async function getPlayerByDiscordId(discordId) {
  return (await queryOne(SQL.findByDiscordId, [discordId])) ?? null;
}

export async function getActiveEffectModifiers(discordId) {
  return query(SQL.getActiveEffectModifiers, [discordId]);
}

export async function searchPlayersByUsername(searchQuery, { page = 1, pageSize = 10 } = {}) {
  const like = `%${searchQuery.trim()}%`;
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;
  const rows = await query(SQL.search, [like, like, like, pageSize, offset]);
  const { total } = await queryOne(SQL.countSearch, [like, like, like]);
  return { rows, total, page: safePage, pageSize };
}

export async function listRegisteredPlayers() {
  return query(SQL.listRegistered);
}

export async function getSpawnCoords() {
  const x = parseInt(await getSetting('spawn_x', String(DEFAULT_SPAWN_X)), 10);
  const y = parseInt(await getSetting('spawn_y', String(DEFAULT_SPAWN_Y)), 10);
  return {
    x: Number.isFinite(x) ? x : DEFAULT_SPAWN_X,
    y: Number.isFinite(y) ? y : DEFAULT_SPAWN_Y,
  };
}

export async function setSpawnCoords(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error('Las coordenadas de aparición deben ser números enteros.');
  }
  if (x < 0 || y < 0) {
    throw new Error('Las coordenadas de aparición no pueden ser negativas — el mapa no tiene casillas negativas.');
  }
  await setSetting('spawn_x', String(x));
  await setSetting('spawn_y', String(y));
  logger.info(`[PlayerService] Casilla de aparición cambiada a (${x},${y})`);
}
