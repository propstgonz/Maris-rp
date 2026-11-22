import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  getByName: `SELECT * FROM ${T.npc_group_types} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.npc_group_types} WHERE id = ?`,
  list:      `SELECT * FROM ${T.npc_group_types} ORDER BY display_name ASC`,

  getNpcTypeByName: `SELECT id, name, display_name, emoji FROM ${T.npc_types} WHERE name = ?`,

  insert: `
    INSERT INTO ${T.npc_group_types} (name, display_name, emoji, description, spawn_chance_percent, is_aggressive, flee_chance_percent, surrender_chance_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,

  insertMember: `INSERT INTO ${T.npc_group_type_members} (group_type_id, npc_type_id, quantity) VALUES (?, ?, ?)`,
  getMembers: `
    SELECT ngm.id, ngm.quantity, nt.id AS npc_type_id, nt.name, nt.display_name, nt.emoji
    FROM ${T.npc_group_type_members} ngm JOIN ${T.npc_types} nt ON ngm.npc_type_id = nt.id
    WHERE ngm.group_type_id = ?
    ORDER BY nt.display_name ASC
  `,
  deleteMembers: `DELETE FROM ${T.npc_group_type_members} WHERE group_type_id = ?`,

  getTerrainTypeByName: `SELECT id, name FROM ${T.terrain_types} WHERE name = ?`,
  insertTerrain: `
    INSERT INTO ${T.npc_group_type_terrains} (group_type_id, terrain_type_id, spawn_chance_override_percent) VALUES (?, ?, ?)
  `,
  getTerrains: `
    SELECT tt.id, tt.name, tt.display_name, tt.emoji, ngt.spawn_chance_override_percent
    FROM ${T.npc_group_type_terrains} ngt JOIN ${T.terrain_types} tt ON ngt.terrain_type_id = tt.id
    WHERE ngt.group_type_id = ?
    ORDER BY tt.display_name ASC
  `,
  deleteTerrains: `DELETE FROM ${T.npc_group_type_terrains} WHERE group_type_id = ?`,

  getZoneByName: `SELECT id, name FROM ${T.zones} WHERE name = ?`,
  insertZone: `
    INSERT INTO ${T.npc_group_type_zones} (group_type_id, zone_id, spawn_chance_override_percent) VALUES (?, ?, ?)
  `,
  getZones: `
    SELECT z.id, z.name, z.display_name, z.emoji, ngz.spawn_chance_override_percent
    FROM ${T.npc_group_type_zones} ngz JOIN ${T.zones} z ON ngz.zone_id = z.id
    WHERE ngz.group_type_id = ?
    ORDER BY z.display_name ASC
  `,
  deleteZones: `DELETE FROM ${T.npc_group_type_zones} WHERE group_type_id = ?`,

  countLiveInstances: `SELECT COUNT(*) AS cnt FROM ${T.npcs} WHERE spawned_from_group_type_id = ?`,
  delete: `DELETE FROM ${T.npc_group_types} WHERE name = ?`,
};

async function _insertMembers(groupTypeId, members) {
  for (const { name: npcTypeName, quantity } of members) {
    const npcType = await queryOne(SQL.getNpcTypeByName, [npcTypeName.toLowerCase().trim()]);
    if (!npcType) throw new Error(`El tipo de NPC \`${npcTypeName}\` no existe en el catálogo.`);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Cantidad inválida para \`${npcTypeName}\`: debe ser un número entero mayor que 0.`);
    }
    await execute(SQL.insertMember, [groupTypeId, npcType.id, quantity]);
  }
}

async function _insertTerrains(groupTypeId, terrains) {
  for (const entry of terrains) {
    const isPlainName = typeof entry === 'string';
    const terrainName = isPlainName ? entry : entry.name;
    const overridePercent = isPlainName ? null : (entry.overridePercent ?? null);
    if (overridePercent !== null && (overridePercent < 0 || overridePercent > 100)) {
      throw new Error(`El % de aparición para el terreno \`${terrainName}\` debe estar entre 0 y 100.`);
    }
    const terrain = await queryOne(SQL.getTerrainTypeByName, [terrainName.toLowerCase().trim()]);
    if (!terrain) throw new Error(`El tipo de terreno \`${terrainName}\` no existe.`);
    await execute(SQL.insertTerrain, [groupTypeId, terrain.id, overridePercent]);
  }
}

async function _insertZones(groupTypeId, zones) {
  for (const entry of zones) {
    const isPlainName = typeof entry === 'string';
    const zoneName = isPlainName ? entry : entry.name;
    const overridePercent = isPlainName ? null : (entry.overridePercent ?? null);
    if (overridePercent !== null && (overridePercent < 0 || overridePercent > 100)) {
      throw new Error(`El % de aparición para la zona \`${zoneName}\` debe estar entre 0 y 100.`);
    }
    const zone = await queryOne(SQL.getZoneByName, [zoneName.toLowerCase().trim()]);
    if (!zone) throw new Error(`La zona \`${zoneName}\` no existe.`);
    await execute(SQL.insertZone, [groupTypeId, zone.id, overridePercent]);
  }
}

export async function listNpcGroupTypes() {
  return query(SQL.list);
}

export async function getNpcGroupTypeByName(name) {
  return (await queryOne(SQL.getByName, [name])) ?? null;
}

export async function getNpcGroupTypeById(id) {
  return (await queryOne(SQL.getById, [id])) ?? null;
}

export async function createNpcGroupType({
  name, displayName, emoji = '👥', description = '',
  spawnChancePercent = 0, isAggressive = false, fleeChancePercent = 100, surrenderChancePercent = 50,
  members = [], terrains = [],
}) {
  if (await queryOne(SQL.getByName, [name])) {
    throw new Error(`Ya existe un grupo de NPC con el nombre \`${name}\`.`);
  }
  if (spawnChancePercent < 0 || spawnChancePercent > 100) {
    throw new Error('El % de aparición debe estar entre 0 y 100.');
  }
  if (fleeChancePercent < 0 || fleeChancePercent > 100) {
    throw new Error('El % de éxito al huir debe estar entre 0 y 100.');
  }
  if (surrenderChancePercent < 0 || surrenderChancePercent > 100) {
    throw new Error('El % de perdonar una rendición debe estar entre 0 y 100.');
  }

  const id = await withTransaction(async () => {
    const result = await execute(SQL.insert, [name, displayName, emoji, description, spawnChancePercent, isAggressive ? 1 : 0, fleeChancePercent, surrenderChancePercent]);
    const newId = result.lastInsertRowid;
    await _insertMembers(newId, members);
    await _insertTerrains(newId, terrains);
    return newId;
  });

  logger.info(`[NpcGroupTypes] Grupo creado: "${name}" (${displayName})`);
  return queryOne(SQL.getById, [id]);
}

export async function updateNpcGroupType(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún grupo de NPC llamado \`${name}\`.`);

  if (updates.spawnChancePercent !== undefined && (updates.spawnChancePercent < 0 || updates.spawnChancePercent > 100)) {
    throw new Error('El % de aparición debe estar entre 0 y 100.');
  }
  if (updates.fleeChancePercent !== undefined && (updates.fleeChancePercent < 0 || updates.fleeChancePercent > 100)) {
    throw new Error('El % de éxito al huir debe estar entre 0 y 100.');
  }
  if (updates.surrenderChancePercent !== undefined && (updates.surrenderChancePercent < 0 || updates.surrenderChancePercent > 100)) {
    throw new Error('El % de perdonar una rendición debe estar entre 0 y 100.');
  }

  const map = {
    displayName: 'display_name',
    emoji: 'emoji',
    description: 'description',
    spawnChancePercent: 'spawn_chance_percent',
    fleeChancePercent: 'flee_chance_percent',
    surrenderChancePercent: 'surrender_chance_percent',
  };
  const fields = [];
  const values = [];

  if (updates.isAggressive !== undefined) { fields.push('is_aggressive = ?'); values.push(updates.isAggressive ? 1 : 0); }
  for (const [key, column] of Object.entries(map)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(updates[key]);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(name);
  await execute(`UPDATE ${T.npc_group_types} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[NpcGroupTypes] Grupo "${name}" actualizado: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [name]);
}

export async function deleteNpcGroupType(name) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún grupo de NPC llamado \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countLiveInstances, [existing.id]);
  if (cnt > 0) {
    throw new Error(`No se puede eliminar \`${name}\`: hay **${cnt}** NPC(s) en el mapa que vinieron de este grupo.`);
  }

  await withTransaction(async () => {
    await execute(SQL.deleteMembers, [existing.id]);
    await execute(SQL.deleteTerrains, [existing.id]);
    await execute(SQL.deleteZones, [existing.id]);
    await execute(SQL.delete, [name]);
  });

  logger.info(`[NpcGroupTypes] Grupo eliminado: "${name}"`);
  return existing;
}

export async function getMembers(groupTypeId) {
  return query(SQL.getMembers, [groupTypeId]);
}

export async function setMembers(name, members = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún grupo de NPC llamado \`${name}\`.`);
  if (members.length === 0) {
    throw new Error('Un grupo necesita al menos un tipo de NPC en su composición.');
  }

  await withTransaction(async () => {
    await execute(SQL.deleteMembers, [existing.id]);
    await _insertMembers(existing.id, members);
  });

  logger.info(`[NpcGroupTypes] Composición de "${name}" reemplazada (${members.length} línea(s))`);
  return query(SQL.getMembers, [existing.id]);
}

export async function getTerrains(groupTypeId) {
  return query(SQL.getTerrains, [groupTypeId]);
}

export async function setTerrains(name, terrains = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún grupo de NPC llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteTerrains, [existing.id]);
    await _insertTerrains(existing.id, terrains);
  });

  logger.info(`[NpcGroupTypes] Terrenos de "${name}" reemplazados (${terrains.length})`);
  return query(SQL.getTerrains, [existing.id]);
}

export async function getZones(groupTypeId) {
  return query(SQL.getZones, [groupTypeId]);
}

export async function setZones(name, zones = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún grupo de NPC llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteZones, [existing.id]);
    await _insertZones(existing.id, zones);
  });

  logger.info(`[NpcGroupTypes] Zonas de "${name}" reemplazadas (${zones.length})`);
  return query(SQL.getZones, [existing.id]);
}
