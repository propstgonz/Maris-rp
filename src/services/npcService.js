import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { getNpcTypeById, getDrops } from './npcTypeService.js';
import { getNpcGroupTypeById, getMembers as getGroupMembers } from './npcGroupTypeService.js';
import { getItemById } from './itemService.js';
import { spawnLoot } from './tileItemService.js';
import { getNpcStorageContents } from './npcProductionService.js';
import { sendPlayerAlert } from './playerAlertService.js';
import { seedNpcInventory } from './npcInventoryService.js';

const NPC_TYPE_COLUMNS = `
  nt.name AS type_name, nt.display_name AS type_display_name, nt.emoji AS type_emoji,
  (nt.max_hp + COALESCE(mi.mount_hp_bonus, 0)) AS type_max_hp,
  nt.weapon_item_id, nt.secondary_weapon_item_id, nt.image_filename,
  nt.heal_item_id, nt.heal_threshold_percent,
  nt.mount_item_id, COALESCE(mi.mount_damage_bonus, 0) AS mount_damage_bonus,
  nt.is_aggressive, nt.theft_chance_percent, nt.trade_margin_percent, nt.surrender_chance_percent,
  nt.is_tameable, nt.tame_chance_percent, nt.tame_bait_item_id,
  nt.vehicle_category, nt.vehicle_speed_multiplier, nt.breed_chance_percent,
  nt.faction_id AS type_faction_id, fac.display_name AS faction_display_name, fac.emoji AS faction_emoji
`;
const NPC_TYPE_JOIN = `
  JOIN ${T.npc_types} nt ON n.npc_type_id = nt.id
  LEFT JOIN ${T.items} mi ON nt.mount_item_id = mi.id
  LEFT JOIN ${T.factions} fac ON nt.faction_id = fac.id
`;

const SQL = {
  getTile: `SELECT id, coord_x, coord_y FROM ${T.map_tiles} WHERE coord_x = ? AND coord_y = ?`,

  insert: `
    INSERT INTO ${T.npcs} (tile_id, npc_type_id, current_hp, is_wild, encountered_by_player_id)
    VALUES (?, ?, ?, ?, ?)
  `,
  insertOwned: `
    INSERT INTO ${T.npcs} (tile_id, npc_type_id, current_hp, is_wild, owner_player_id)
    VALUES (?, ?, ?, 0, ?)
  `,
  insertGroupMember: `
    INSERT INTO ${T.npcs} (tile_id, npc_type_id, current_hp, is_wild, encountered_by_player_id, spawned_from_group_type_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  getOwnerDiscordId: `SELECT discord_id FROM ${T.players} WHERE id = ?`,
  getAlivePlayerAtTile: `
    SELECT * FROM ${T.players}
    WHERE coord_x = ? AND coord_y = ? AND is_alive = 1 AND character_created_at IS NOT NULL
    LIMIT 1
  `,

  getById: `
    SELECT n.*, t.coord_x, t.coord_y, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    WHERE n.id = ?
  `,

  getAtTile: `
    SELECT n.*, t.coord_x, t.coord_y, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    WHERE t.coord_x = ? AND t.coord_y = ?
    LIMIT 1
  `,

  getInRadius: `
    SELECT n.*, t.coord_x, t.coord_y, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    WHERE t.coord_x BETWEEN ? AND ?
      AND t.coord_y BETWEEN ? AND ?
  `,

  getSoldiersAtTile: `
    SELECT n.*, t.coord_x, t.coord_y, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    WHERE t.coord_x = ? AND t.coord_y = ? AND n.role = 'soldier' AND n.owner_player_id IS NOT NULL
    ORDER BY n.id ASC
  `,

  countBlockingEncounters: `
    SELECT COUNT(*) AS cnt
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t   ON n.tile_id = t.id
    JOIN ${T.npc_types} nt  ON n.npc_type_id = nt.id
    JOIN ${T.players} p     ON p.id = n.encountered_by_player_id
    LEFT JOIN ${T.npc_group_types} gt ON n.spawned_from_group_type_id = gt.id
    WHERE n.encountered_by_player_id = ? AND n.is_wild = 1
      AND COALESCE(gt.is_aggressive, nt.is_aggressive) = 1
      AND t.coord_x = p.coord_x AND t.coord_y = p.coord_y
  `,
  getBlockingEncounters: `
    SELECT n.id, n.spawned_from_group_type_id, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t   ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    JOIN ${T.players} p     ON p.id = n.encountered_by_player_id
    LEFT JOIN ${T.npc_group_types} gt ON n.spawned_from_group_type_id = gt.id
    WHERE n.encountered_by_player_id = ? AND n.is_wild = 1
      AND COALESCE(gt.is_aggressive, nt.is_aggressive) = 1
      AND t.coord_x = p.coord_x AND t.coord_y = p.coord_y
    ORDER BY n.id ASC
  `,
  releaseGroupEncounter: `
    UPDATE ${T.npcs}
    SET encountered_by_player_id = NULL, encountered_channel_id = NULL,
        encountered_channel_message_id = NULL, encountered_dm_message_id = NULL
    WHERE encountered_by_player_id = ? AND spawned_from_group_type_id = ?
  `,
  releaseEncounter: `
    UPDATE ${T.npcs}
    SET encountered_by_player_id = NULL, encountered_channel_id = NULL,
        encountered_channel_message_id = NULL, encountered_dm_message_id = NULL
    WHERE id = ?
  `,
  releaseEncountersAwayFromPlayer: `
    UPDATE ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    JOIN ${T.players} p   ON p.id = n.encountered_by_player_id
    SET n.encountered_by_player_id = NULL, n.encountered_channel_id = NULL,
        n.encountered_channel_message_id = NULL, n.encountered_dm_message_id = NULL
    WHERE n.encountered_by_player_id = ?
      AND (t.coord_x <> p.coord_x OR t.coord_y <> p.coord_y)
  `,
  getWildEncounteredByGroup: `
    SELECT n.*, t.coord_x, t.coord_y, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    WHERE n.encountered_by_player_id = ? AND n.spawned_from_group_type_id = ? AND n.is_wild = 1
    ORDER BY n.id ASC
  `,

  setHp: `UPDATE ${T.npcs} SET current_hp = ? WHERE id = ?`,
  getHpForUpdate: `SELECT current_hp FROM ${T.npcs} WHERE id = ? FOR UPDATE`,
  delete: `DELETE FROM ${T.npcs} WHERE id = ?`,

  tame: `
    UPDATE ${T.npcs} SET is_wild = 0, owner_player_id = ?, is_active_mount = 0,
      encountered_by_player_id = NULL, encountered_channel_id = NULL,
      encountered_channel_message_id = NULL, encountered_dm_message_id = NULL
    WHERE id = ? AND owner_player_id IS NULL
  `,
  clearActiveMount: `UPDATE ${T.npcs} SET is_active_mount = 0 WHERE owner_player_id = ? AND is_active_mount = 1`,
  setActiveMount: `UPDATE ${T.npcs} SET is_active_mount = 1 WHERE id = ? AND owner_player_id = ?`,
  getActiveMount: `
    SELECT n.*, t.coord_x, t.coord_y, ${NPC_TYPE_COLUMNS}
    FROM ${T.npcs} n
    JOIN ${T.map_tiles} t ON n.tile_id = t.id
    ${NPC_TYPE_JOIN}
    WHERE n.owner_player_id = ? AND n.is_active_mount = 1
    LIMIT 1
  `,
  moveToTile: `UPDATE ${T.npcs} SET tile_id = ? WHERE id = ?`,
  setBredAt: `UPDATE ${T.npcs} SET last_bred_at = NOW() WHERE id IN (?, ?)`,
};

async function _initialHp(npcType) {
  if (!npcType.mount_item_id) return npcType.max_hp;
  const mount = await getItemById(npcType.mount_item_id);
  return npcType.max_hp + (mount?.mount_hp_bonus ?? 0);
}

export async function placeNpc(x, y, npcTypeId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) throw new Error(`No existe ninguna casilla en (${x}, ${y}). Créala primero con /map create.`);

  const npcType = await getNpcTypeById(npcTypeId);
  if (!npcType) throw new Error(`No existe ningún tipo de NPC con ID ${npcTypeId}.`);

  if (await queryOne(SQL.getAtTile, [x, y])) {
    throw new Error(`Ya hay un NPC en (${x}, ${y}) — quítalo primero si quieres poner otro.`);
  }

  const playerHere = await queryOne(SQL.getAlivePlayerAtTile, [x, y]);
  const isWild = playerHere ? 1 : 0;
  const encounteredByPlayerId = playerHere ? playerHere.id : null;

  const result = await execute(SQL.insert, [tile.id, npcTypeId, await _initialHp(npcType), isWild, encounteredByPlayerId]);
  await seedNpcInventory(result.lastInsertRowid, npcTypeId);
  logger.info(`[Npc] "${npcType.display_name}" colocado a mano @ (${x},${y})${playerHere ? ` — genera un encuentro con ${playerHere.username}` : ''}`);
  return queryOne(SQL.getById, [result.lastInsertRowid]);
}

export async function spawnWildNpc(x, y, npcTypeId, encounteredByPlayerId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) throw new Error(`No existe ninguna casilla en (${x}, ${y}).`);
  const npcType = await getNpcTypeById(npcTypeId);
  if (!npcType) throw new Error(`No existe ningún tipo de NPC con ID ${npcTypeId}.`);

  if (await queryOne(SQL.getAtTile, [x, y])) return null;

  const result = await execute(SQL.insert, [tile.id, npcTypeId, await _initialHp(npcType), 1, encounteredByPlayerId]);
  await seedNpcInventory(result.lastInsertRowid, npcTypeId);
  logger.info(`[Npc] Encuentro salvaje: "${npcType.display_name}" @ (${x},${y})`);
  return queryOne(SQL.getById, [result.lastInsertRowid]);
}

export async function spawnWildNpcGroup(x, y, groupTypeId, encounteredByPlayerId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) throw new Error(`No existe ninguna casilla en (${x}, ${y}).`);
  const groupType = await getNpcGroupTypeById(groupTypeId);
  if (!groupType) throw new Error(`No existe ningún grupo de NPC con ID ${groupTypeId}.`);
  const members = await getGroupMembers(groupTypeId);
  if (members.length === 0) return null;

  if (await queryOne(SQL.getAtTile, [x, y])) return null;

  const created = [];
  for (const member of members) {
    const npcType = await getNpcTypeById(member.npc_type_id);
    for (let i = 0; i < member.quantity; i++) {
      const result = await execute(SQL.insertGroupMember, [tile.id, member.npc_type_id, await _initialHp(npcType), 1, encounteredByPlayerId, groupTypeId]);
      await seedNpcInventory(result.lastInsertRowid, member.npc_type_id);
      created.push(await queryOne(SQL.getById, [result.lastInsertRowid]));
    }
  }
  logger.info(`[Npc] Encuentro salvaje de grupo: "${groupType.display_name}" (${created.length} NPC) @ (${x},${y})`);
  return created;
}

export async function placeNpcGroup(x, y, groupTypeId) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) throw new Error(`No existe ninguna casilla en (${x}, ${y}). Créala primero con /map create.`);

  const groupType = await getNpcGroupTypeById(groupTypeId);
  if (!groupType) throw new Error(`No existe ningún grupo de NPC con ID ${groupTypeId}.`);

  const members = await getGroupMembers(groupTypeId);
  if (members.length === 0) throw new Error(`El grupo "${groupType.display_name}" no tiene ningún NPC configurado en su composición.`);

  if (await queryOne(SQL.getAtTile, [x, y])) {
    throw new Error(`Ya hay un NPC en (${x}, ${y}) — quítalo primero si quieres plantar un grupo.`);
  }

  const playerHere = await queryOne(SQL.getAlivePlayerAtTile, [x, y]);
  const isWild = playerHere ? 1 : 0;
  const encounteredByPlayerId = playerHere ? playerHere.id : null;

  const created = [];
  for (const member of members) {
    const npcType = await getNpcTypeById(member.npc_type_id);
    for (let i = 0; i < member.quantity; i++) {
      const result = await execute(SQL.insertGroupMember, [tile.id, member.npc_type_id, await _initialHp(npcType), isWild, encounteredByPlayerId, groupTypeId]);
      await seedNpcInventory(result.lastInsertRowid, member.npc_type_id);
      created.push(await queryOne(SQL.getById, [result.lastInsertRowid]));
    }
  }

  logger.info(`[Npc] Grupo "${groupType.display_name}" (${created.length} NPC) colocado a mano @ (${x},${y})${playerHere ? ` — genera un encuentro con ${playerHere.username}` : ''}`);
  return created;
}

export async function createOwnedNpc(tileId, npcTypeId, ownerPlayerId) {
  const npcType = await getNpcTypeById(npcTypeId);
  if (!npcType) throw new Error(`No existe ningún tipo de NPC con ID ${npcTypeId}.`);

  const result = await execute(SQL.insertOwned, [tileId, npcTypeId, await _initialHp(npcType), ownerPlayerId]);
  logger.info(`[Npc] "${npcType.display_name}" reclutado para el jugador #${ownerPlayerId}`);
  return getNpcById(result.lastInsertRowid);
}

export async function getNpcAtTile(x, y) {
  return (await queryOne(SQL.getAtTile, [x, y])) ?? null;
}

export async function getNpcsAtTile(x, y) {
  return query(SQL.getInRadius, [x, x, y, y]);
}

export async function getSoldierNpcsAtTile(x, y) {
  return query(SQL.getSoldiersAtTile, [x, y]);
}


export async function countBlockingEncounters(playerId) {
  if (playerId == null) return 0;
  const { cnt } = await queryOne(SQL.countBlockingEncounters, [playerId]);
  return cnt;
}

export async function releaseEncounter(npcId) {
  if (npcId == null) return false;
  const info = await execute(SQL.releaseEncounter, [npcId]);
  return info.changes > 0;
}

export async function getBlockingEncounters(playerId) {
  if (playerId == null) return [];
  return query(SQL.getBlockingEncounters, [playerId]);
}

export async function releaseGroupEncounter(playerId, groupTypeId) {
  if (playerId == null || groupTypeId == null) return 0;
  const info = await execute(SQL.releaseGroupEncounter, [playerId, groupTypeId]);
  return info.changes;
}

export async function releaseEncountersAwayFromPlayer(playerId) {
  if (playerId == null) return 0;
  const info = await execute(SQL.releaseEncountersAwayFromPlayer, [playerId]);
  return info.changes;
}

export async function getWildNpcsEncounteredBy(playerId, groupTypeId) {
  return query(SQL.getWildEncounteredByGroup, [playerId, groupTypeId]);
}

export async function getNpcById(id) {
  return (await queryOne(SQL.getById, [id])) ?? null;
}

export async function getNpcsInRadius(x, y, radius) {
  const r = Math.max(0, Math.trunc(radius));
  const rows = await query(SQL.getInRadius, [x - r, x + r, y - r, y + r]);
  return rows
    .map(n => ({ ...n, distance: Math.max(Math.abs(n.coord_x - x), Math.abs(n.coord_y - y)) }))
    .sort((a, b) => a.distance - b.distance);
}

export async function tameNpc(npcId, ownerId) {
  const result = await execute(SQL.tame, [ownerId, npcId]);
  return result.changes > 0;
}

export async function setActiveMount(npcId, ownerId) {
  return withTransaction(async () => {
    await execute(SQL.clearActiveMount, [ownerId]);
    return (await execute(SQL.setActiveMount, [npcId, ownerId])).changes > 0;
  });
}

export async function clearActiveMount(ownerId) {
  await execute(SQL.clearActiveMount, [ownerId]);
}

export async function getActiveMount(ownerId) {
  return (await queryOne(SQL.getActiveMount, [ownerId])) ?? null;
}

export async function moveNpcToTile(npcId, tileId) {
  await execute(SQL.moveToTile, [tileId, npcId]);
}

export async function markBred(parentAId, parentBId) {
  await execute(SQL.setBredAt, [parentAId, parentBId]);
}

export async function removeNpc(id) {
  const npc = await queryOne(SQL.getById, [id]);
  if (!npc) throw new Error(`No existe ningún NPC con ID ${id}.`);
  await execute(SQL.delete, [id]);
  logger.info(`[Npc] "${npc.type_display_name}" #${id} quitado a mano @ (${npc.coord_x},${npc.coord_y})`);
  return npc;
}

export async function damageNpc(npcId, amount) {
  return withTransaction(async () => {
    const locked = await queryOne(SQL.getHpForUpdate, [npcId]);
    if (!locked) throw new Error(`No existe ningún NPC con ID ${npcId}.`);
    const npc = await queryOne(SQL.getById, [npcId]);

    const healthBefore = locked.current_hp;
    const healthAfter = Math.max(0, healthBefore - amount);
    await execute(SQL.setHp, [healthAfter, npcId]);

    return { npc, healthBefore, healthAfter, died: healthAfter <= 0 };
  });
}

export async function healNpc(npcId, amount) {
  return withTransaction(async () => {
    const locked = await queryOne(SQL.getHpForUpdate, [npcId]);
    if (!locked) throw new Error(`No existe ningún NPC con ID ${npcId}.`);
    const npc = await queryOne(SQL.getById, [npcId]);

    const healthBefore = locked.current_hp;
    const healthAfter = Math.min(npc.type_max_hp, healthBefore + amount);
    await execute(SQL.setHp, [healthAfter, npcId]);

    return { npc, healthBefore, healthAfter };
  });
}

export async function resolveNpcDeath(npcId, { client = null } = {}) {
  const npc = await queryOne(SQL.getById, [npcId]);
  if (!npc) throw new Error(`No existe ningún NPC con ID ${npcId}.`);

  const dropTable = await getDrops(npc.npc_type_id);
  const drops = [];
  for (const drop of dropTable) {
    if (Math.random() * 100 < drop.drop_chance_percent) {
      await spawnLoot(npc.coord_x, npc.coord_y, drop.name, drop.quantity);
      drops.push({ name: drop.name, display_name: drop.display_name, emoji: drop.emoji, quantity: drop.quantity });
    }
  }

  if (npc.owner_player_id != null) {
    const stashed = await getNpcStorageContents(npcId);
    for (const stash of stashed) {
      if (stash.quantity > 0) {
        await spawnLoot(npc.coord_x, npc.coord_y, stash.name, stash.quantity);
        drops.push({ name: stash.name, display_name: stash.display_name, emoji: stash.emoji, quantity: stash.quantity });
      }
    }

    if (client) {
      const owner = await queryOne(SQL.getOwnerDiscordId, [npc.owner_player_id]);
      if (owner) {
        await sendPlayerAlert(
          client, owner.discord_id, 'structureAttacked',
          `💀 Tu NPC reclutado **${npc.type_display_name}** ha muerto en (${npc.coord_x},${npc.coord_y}) — ` +
          `perdiste la inversión de equipo y cualquier producción sin recoger.\n` +
          `-# Puedes desactivar este aviso con \`/personaje alertas ataque:false\`.`
        );
      }
    }
  }

  await execute(SQL.delete, [npcId]);
  logger.info(`[Npc] "${npc.type_display_name}" #${npcId} murió @ (${npc.coord_x},${npc.coord_y}) — botín: ${drops.map(d => `${d.name}×${d.quantity}`).join(', ') || 'nada'}`);

  return { npc, drops };
}
