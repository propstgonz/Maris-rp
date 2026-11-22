import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { CONSTRUCTION_ALIVE_SQL } from '../utils/sql.js';
import { normalizeRange } from './mapService.js';

const DEFAULT_RANKS = [
  { name: 'miembro',  displayName: 'Miembro',  emoji: '🔹', rankOrder: 0, isDefault: true,  isLeader: false },
  { name: 'veterano', displayName: 'Veterano', emoji: '🔸', rankOrder: 1, isDefault: false, isLeader: false },
  { name: 'colider',  displayName: 'Colíder',  emoji: '🔶', rankOrder: 2, isDefault: false, isLeader: false },
  { name: 'lider',    displayName: 'Líder',    emoji: '👑', rankOrder: 3, isDefault: false, isLeader: true  },
];

const SQL = {
  getByName: `SELECT * FROM ${T.factions} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.factions} WHERE id = ?`,
  list:      `
    SELECT n.*, COUNT(t.id) AS tile_count
    FROM ${T.factions} n
    LEFT JOIN ${T.map_tiles} t ON t.faction_id = n.id
    GROUP BY n.id
    ORDER BY n.display_name ASC
  `,

  insert: `
    INSERT INTO ${T.factions} (name, display_name, emoji, description, is_npc)
    VALUES (?, ?, ?, ?, ?)
  `,

  delete: `DELETE FROM ${T.factions} WHERE name = ?`,

  clearNpcTypeFaction: `UPDATE ${T.npc_types} SET faction_id = NULL WHERE faction_id = ?`,

  countTilesByFaction: `SELECT COUNT(*) AS cnt FROM ${T.map_tiles} WHERE faction_id = ?`,

  assignRange: `
    UPDATE ${T.map_tiles} SET faction_id = ?
    WHERE coord_x BETWEEN ? AND ? AND coord_y BETWEEN ? AND ?
  `,

  unassignRange: `
    UPDATE ${T.map_tiles} SET faction_id = NULL
    WHERE coord_x BETWEEN ? AND ? AND coord_y BETWEEN ? AND ?
  `,

  countTilesInRange: `
    SELECT COUNT(*) AS cnt FROM ${T.map_tiles}
    WHERE coord_x BETWEEN ? AND ? AND coord_y BETWEEN ? AND ?
  `,

  countConstructionTypeInRange: `
    SELECT COUNT(*) AS cnt
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    WHERE ct.name = ?
      AND t.coord_x BETWEEN ? AND ? AND t.coord_y BETWEEN ? AND ?
      AND (${CONSTRUCTION_ALIVE_SQL})
  `,

  setOwner: `UPDATE ${T.factions} SET owner_player_id = ? WHERE name = ?`,

  getPlayerByDiscordId: `SELECT id, discord_id, username, character_name, faction_id, faction_rank_id FROM ${T.players} WHERE discord_id = ?`,
  getPlayerById:         `SELECT id, discord_id, username, character_name, faction_id, faction_rank_id FROM ${T.players} WHERE id = ?`,
  setPlayerFaction: `UPDATE ${T.players} SET faction_id = ?, faction_rank_id = NULL WHERE discord_id = ?`,

  getPendingApplication: `
    SELECT * FROM ${T.faction_applications} WHERE player_id = ? AND faction_id = ? AND status = 'pending'
  `,
  getAnyApplication: `
    SELECT * FROM ${T.faction_applications} WHERE player_id = ? AND faction_id = ?
    ORDER BY created_at DESC LIMIT 1
  `,
  insertApplication: `
    INSERT INTO ${T.faction_applications} (player_id, faction_id, status, pending_key) VALUES (?, ?, 'pending', ?)
  `,
  getApplicationById: `SELECT * FROM ${T.faction_applications} WHERE id = ?`,
  resolveApplication: `
    UPDATE ${T.faction_applications} SET status = ?, pending_key = NULL, resolved_at = NOW() WHERE id = ?
  `,
  getStalePendingApplications: `
    SELECT * FROM ${T.faction_applications}
    WHERE status = 'pending' AND created_at <= DATE_SUB(NOW(), INTERVAL ? HOUR)
  `,

  insertRank: `
    INSERT INTO ${T.faction_ranks} (faction_id, name, display_name, emoji, rank_order, is_default, is_leader)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  insertRankPermission: `
    INSERT INTO ${T.faction_rank_permissions} (faction_id, action, required_rank_order) VALUES (?, ?, ?)
  `,
};

const DEFAULT_RANK_PERMISSIONS = [
  { action: 'faction.npc_recruit', requiredRankOrder: 2 },
  { action: 'faction.storage_deposit', requiredRankOrder: 0 },
  { action: 'faction.storage_withdraw', requiredRankOrder: 1 },
];

export async function listFactions() {
  return query(SQL.list);
}

export async function getFactionByName(name) {
  return (await queryOne(SQL.getByName, [name.toLowerCase().trim()])) ?? null;
}

export async function getFactionById(id) {
  return (await queryOne(SQL.getById, [id])) ?? null;
}

export async function createFaction({ name, displayName, emoji = '🏳️', description = '', isNpc = false }) {
  const normalized = name.toLowerCase().trim();
  if (await queryOne(SQL.getByName, [normalized])) {
    throw new Error(`Ya existe una facción con el nombre \`${normalized}\`.`);
  }

  const result = await execute(SQL.insert, [normalized, displayName, emoji, description, isNpc ? 1 : 0]);
  const factionId = result.lastInsertRowid;
  for (const rank of DEFAULT_RANKS) {
    await execute(SQL.insertRank, [factionId, rank.name, rank.displayName, rank.emoji, rank.rankOrder, rank.isDefault ? 1 : 0, rank.isLeader ? 1 : 0]);
  }
  for (const perm of DEFAULT_RANK_PERMISSIONS) {
    await execute(SQL.insertRankPermission, [factionId, perm.action, perm.requiredRankOrder]);
  }

  logger.info(`[Factions] Facción creada: "${normalized}" (${displayName})`);
  return queryOne(SQL.getById, [factionId]);
}

export async function updateFaction(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ninguna facción llamada \`${name}\`.`);

  const map = { displayName: 'display_name', emoji: 'emoji', description: 'description' };
  const fields = [];
  const values = [];

  if (updates.isNpc !== undefined) {
    if (updates.isNpc && existing.owner_player_id) {
      throw new Error('Quítale primero el dueño: una facción NPC no puede tener a un jugador al mando.');
    }
    fields.push('is_npc = ?');
    values.push(updates.isNpc ? 1 : 0);
  }
  for (const [key, column] of Object.entries(map)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(updates[key]);
  }

  if (fields.length === 0) throw new Error('Debes especificar al menos un campo para editar.');

  values.push(existing.name);
  await execute(`UPDATE ${T.factions} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[Factions] Facción "${existing.name}" actualizada: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [existing.name]);
}

export async function deleteFaction(name) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ninguna facción llamada \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countTilesByFaction, [existing.id]);
  await withTransaction(async () => {
    await execute(SQL.clearNpcTypeFaction, [existing.id]);
    await execute(SQL.delete, [existing.name]);
  });

  logger.info(`[Factions] Facción eliminada: "${existing.name}" (${cnt} casilla(s) quedaron sin facción)`);
  return { deleted: existing, tilesAffected: cnt };
}

export async function assignRange(x1, y1, x2, y2, factionName) {
  const faction = await queryOne(SQL.getByName, [factionName.toLowerCase().trim()]);
  if (!faction) throw new Error(`No existe ninguna facción llamada \`${factionName}\`. Usa \`/faccion list\`.`);

  const { minX, maxX, minY, maxY } = normalizeRange(x1, y1, x2, y2);
  const result = await execute(SQL.assignRange, [faction.id, minX, maxX, minY, maxY]);

  logger.info(`[Factions] "${faction.name}" asignada a ${result.changes} casilla(s) en (${minX},${minY})-(${maxX},${maxY})`);
  return { faction, tilesAssigned: result.changes };
}

export async function unassignRange(x1, y1, x2, y2) {
  const { minX, maxX, minY, maxY } = normalizeRange(x1, y1, x2, y2);
  const result = await execute(SQL.unassignRange, [minX, maxX, minY, maxY]);

  logger.info(`[Factions] Facción quitada de ${result.changes} casilla(s) en (${minX},${minY})-(${maxX},${maxY})`);
  return { tilesUnassigned: result.changes };
}

export async function countTilesInRange(x1, y1, x2, y2) {
  const { minX, maxX, minY, maxY } = normalizeRange(x1, y1, x2, y2);
  return (await queryOne(SQL.countTilesInRange, [minX, maxX, minY, maxY])).cnt;
}

export async function hasConstructionTypeInRange(x1, y1, x2, y2, typeName) {
  const { minX, maxX, minY, maxY } = normalizeRange(x1, y1, x2, y2);
  return (await queryOne(SQL.countConstructionTypeInRange, [typeName, minX, maxX, minY, maxY])).cnt > 0;
}

export async function setOwner(factionName, discordId) {
  const faction = await queryOne(SQL.getByName, [factionName.toLowerCase().trim()]);
  if (!faction) throw new Error(`No existe ninguna facción llamada \`${factionName}\`.`);

  if (faction.is_npc && discordId) {
    throw new Error(`**${faction.display_name}** es una facción NPC — no puede tener a un jugador al mando.`);
  }

  let playerId = null;
  if (discordId) {
    const player = await queryOne(SQL.getPlayerByDiscordId, [discordId]);
    if (!player) throw new Error('Ese jugador no está registrado. Pídele que use `/personaje crear` primero.');
    playerId = player.id;
  }

  await execute(SQL.setOwner, [playerId, faction.name]);
  logger.info(`[Factions] Dueño de "${faction.name}" → ${discordId ?? '(ninguno)'}`);
  return queryOne(SQL.getByName, [faction.name]);
}

export async function getPlayerMembership(discordId) {
  const player = await queryOne(SQL.getPlayerByDiscordId, [discordId]);
  if (!player?.faction_id) return null;
  return (await queryOne(SQL.getById, [player.faction_id])) ?? null;
}

export async function setMembership(discordId, factionId) {
  const player = await queryOne(SQL.getPlayerByDiscordId, [discordId]);
  if (!player) throw new Error('Ese jugador no está registrado.');

  await execute(SQL.setPlayerFaction, [factionId, discordId]);
  logger.info(`[Factions] Ciudadanía de ${player.username} → faction_id=${factionId ?? '(ninguna)'}`);
  return queryOne(SQL.getPlayerByDiscordId, [discordId]);
}

export async function getAnyApplication(playerId, factionId) {
  return (await queryOne(SQL.getAnyApplication, [playerId, factionId])) ?? null;
}

export async function createApplication(playerId, factionId) {
  const faction = await queryOne(SQL.getById, [factionId]);
  if (faction?.is_npc) {
    throw new Error(`**${faction.display_name}** es una facción NPC — no admite jugadores.`);
  }
  if (await queryOne(SQL.getPendingApplication, [playerId, factionId])) {
    throw new Error('Ya hay una solicitud pendiente para esta facción — espera a que el dueño responda.');
  }

  const result = await execute(SQL.insertApplication, [playerId, factionId, factionId]);
  const application = await queryOne(SQL.getApplicationById, [result.lastInsertRowid]);
  logger.info(`[Factions] Solicitud de incorporación creada: jugador #${playerId} → facción #${factionId} (id ${application.id})`);
  return application;
}

export async function getApplicationById(id) {
  return (await queryOne(SQL.getApplicationById, [id])) ?? null;
}

export async function resolveApplication(applicationId, status) {
  const application = await queryOne(SQL.getApplicationById, [applicationId]);
  if (!application) throw new Error('Esa solicitud ya no existe.');
  if (application.status !== 'pending') {
    throw new Error(`Esa solicitud ya se resolvió (${application.status}) — nada que hacer.`);
  }

  const player = await queryOne(SQL.getPlayerById, [application.player_id]);
  const faction = await queryOne(SQL.getById, [application.faction_id]);

  await execute(SQL.resolveApplication, [status, applicationId]);
  if (status === 'accepted') {
    await execute(SQL.setPlayerFaction, [application.faction_id, player.discord_id]);
  }

  logger.info(`[Factions] Solicitud #${applicationId} (${player?.username} → ${faction?.name}) resuelta: ${status}`);
  return { application: await queryOne(SQL.getApplicationById, [applicationId]), player, faction };
}

export async function expireStalePendingApplications(hoursThreshold = 24) {
  const stale = await query(SQL.getStalePendingApplications, [hoursThreshold]);
  const results = [];

  for (const application of stale) {
    await execute(SQL.resolveApplication, ['expired', application.id]);
    const player = await queryOne(SQL.getPlayerById, [application.player_id]);
    const faction = await queryOne(SQL.getById, [application.faction_id]);
    results.push({ application: await queryOne(SQL.getApplicationById, [application.id]), player, faction });
    logger.info(`[Factions] Solicitud #${application.id} (${player?.username} → ${faction?.name}) expirada tras ${hoursThreshold}h sin respuesta.`);
  }

  return results;
}
