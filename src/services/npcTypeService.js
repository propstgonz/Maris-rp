import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  getByName: `SELECT * FROM ${T.npc_types} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.npc_types} WHERE id = ?`,
  list:      `SELECT * FROM ${T.npc_types} ORDER BY display_name ASC`,

  getWeaponItemByName: `SELECT id, name, display_name, item_type FROM ${T.items} WHERE name = ?`,
  getHealItemByName:   `SELECT id, name, display_name, item_type, is_consumable FROM ${T.items} WHERE name = ?`,
  getMountItemByName:  `SELECT id, name, display_name, item_type FROM ${T.items} WHERE name = ?`,
  getItemByName:       `SELECT id, name, display_name FROM ${T.items} WHERE name = ?`,
  getTerrainTypeByName: `SELECT id, name FROM ${T.terrain_types} WHERE name = ?`,
  getFactionByName:     `SELECT id, name FROM ${T.factions} WHERE name = ?`,

  insert: `
    INSERT INTO ${T.npc_types} (
      name, display_name, emoji, description, max_hp, weapon_item_id, spawn_chance_percent, is_aggressive, flee_chance_percent,
      secondary_weapon_item_id, heal_item_id, heal_threshold_percent, mount_item_id,
      theft_chance_percent, trade_margin_percent, surrender_chance_percent,
      is_tameable, tame_chance_percent, tame_bait_item_id,
      vehicle_category, vehicle_speed_multiplier, breed_chance_percent, faction_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  insertTerrain: `
    INSERT INTO ${T.npc_type_terrains} (npc_type_id, terrain_type_id, spawn_chance_override_percent) VALUES (?, ?, ?)
  `,
  getTerrains: `
    SELECT tt.id, tt.name, tt.display_name, tt.emoji, ntt.spawn_chance_override_percent
    FROM ${T.npc_type_terrains} ntt JOIN ${T.terrain_types} tt ON ntt.terrain_type_id = tt.id
    WHERE ntt.npc_type_id = ?
    ORDER BY tt.display_name ASC
  `,
  deleteTerrains: `DELETE FROM ${T.npc_type_terrains} WHERE npc_type_id = ?`,

  getZoneByName: `SELECT id, name FROM ${T.zones} WHERE name = ?`,
  insertZone: `
    INSERT INTO ${T.npc_type_zones} (npc_type_id, zone_id, spawn_chance_override_percent) VALUES (?, ?, ?)
  `,
  getZones: `
    SELECT z.id, z.name, z.display_name, z.emoji, ntz.spawn_chance_override_percent
    FROM ${T.npc_type_zones} ntz JOIN ${T.zones} z ON ntz.zone_id = z.id
    WHERE ntz.npc_type_id = ?
    ORDER BY z.display_name ASC
  `,
  deleteZones: `DELETE FROM ${T.npc_type_zones} WHERE npc_type_id = ?`,

  insertDrop: `
    INSERT INTO ${T.npc_type_drops} (npc_type_id, item_id, quantity, drop_chance_percent) VALUES (?, ?, ?, ?)
  `,
  getDrops: `
    SELECT ntd.id, ntd.quantity, ntd.drop_chance_percent, i.name, i.display_name, i.emoji
    FROM ${T.npc_type_drops} ntd JOIN ${T.items} i ON ntd.item_id = i.id
    WHERE ntd.npc_type_id = ?
  `,
  deleteDrops: `DELETE FROM ${T.npc_type_drops} WHERE npc_type_id = ?`,

  insertEquipment: `
    INSERT INTO ${T.npc_type_equipment} (npc_type_id, item_id, quantity) VALUES (?, ?, ?)
  `,
  getEquipment: `
    SELECT nte.id, nte.quantity, nte.item_id, i.name, i.display_name, i.emoji
    FROM ${T.npc_type_equipment} nte JOIN ${T.items} i ON nte.item_id = i.id
    WHERE nte.npc_type_id = ?
  `,
  deleteEquipment: `DELETE FROM ${T.npc_type_equipment} WHERE npc_type_id = ?`,

  listRecruitable: `SELECT * FROM ${T.npc_types} WHERE is_recruitable = 1 ORDER BY display_name ASC`,

  setImage: `UPDATE ${T.npc_types} SET image_filename = ? WHERE name = ?`,

  countInstances: `SELECT COUNT(*) AS cnt FROM ${T.npcs} WHERE npc_type_id = ?`,
  delete: `DELETE FROM ${T.npc_types} WHERE name = ?`,
};

export async function listNpcTypes() {
  return query(SQL.list);
}

export async function getNpcTypeByName(name) {
  return (await queryOne(SQL.getByName, [name])) ?? null;
}

export async function getNpcTypeById(id) {
  return (await queryOne(SQL.getById, [id])) ?? null;
}

async function _resolveWeaponItemId(weaponItemName) {
  if (weaponItemName === null) return null;
  const item = await queryOne(SQL.getWeaponItemByName, [weaponItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${weaponItemName}\` no existe en el catálogo.`);
  if (item.item_type !== 'arma') {
    throw new Error(`El ítem \`${weaponItemName}\` no es de tipo arma (es "${item.item_type}") — un NPC solo puede llevar un ítem tipo arma.`);
  }
  return item.id;
}

async function _resolveHealItemId(healItemName) {
  if (healItemName === null) return null;
  const item = await queryOne(SQL.getHealItemByName, [healItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${healItemName}\` no existe en el catálogo.`);
  if (!item.is_consumable) {
    throw new Error(`El ítem \`${healItemName}\` no es consumible — solo un ítem consumible puede usarse como curación.`);
  }
  return item.id;
}

async function _resolveMountItemId(mountItemName) {
  if (mountItemName === null) return null;
  const item = await queryOne(SQL.getMountItemByName, [mountItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${mountItemName}\` no existe en el catálogo.`);
  if (item.item_type !== 'vehiculo') {
    throw new Error(`El ítem \`${mountItemName}\` no es de tipo vehículo (es "${item.item_type}") — una montura debe ser un ítem tipo vehículo.`);
  }
  return item.id;
}

async function _resolveFactionId(factionName) {
  if (factionName === null) return null;
  const faction = await queryOne(SQL.getFactionByName, [factionName.toLowerCase().trim()]);
  if (!faction) throw new Error(`No existe ninguna facción llamada \`${factionName}\`.`);
  return faction.id;
}

async function _resolveBaitItemId(baitItemName) {
  if (baitItemName === null) return null;
  const item = await queryOne(SQL.getItemByName, [baitItemName.toLowerCase().trim()]);
  if (!item) throw new Error(`El ítem \`${baitItemName}\` no existe en el catálogo.`);
  return item.id;
}

const VEHICLE_CATEGORIES = ['aereo', 'maritimo', 'terrestre'];

function _validateVehicleCategory(vehicleCategory) {
  if (vehicleCategory !== null && !VEHICLE_CATEGORIES.includes(vehicleCategory)) {
    throw new Error(`Categoría de vehículo inválida: \`${vehicleCategory}\`. Válidas: ${VEHICLE_CATEGORIES.join(', ')}.`);
  }
}

export async function createNpcType({
  name, displayName, emoji = '👤', description = '', maxHp = 5,
  weaponItemName = null, spawnChancePercent = 0, isAggressive = false, fleeChancePercent = 100,
  secondaryWeaponItemName = null, healItemName = null, healThresholdPercent = 50, mountItemName = null,
  theftChancePercent = 50, tradeMarginPercent = 100, surrenderChancePercent = 50,
  isTameable = false, tameChancePercent = 50, tameBaitItemName = null,
  vehicleCategory = null, vehicleSpeedMultiplier = 1, breedChancePercent = 50,
  factionName = null, terrains = [], drops = [],
}) {
  if (await queryOne(SQL.getByName, [name])) {
    throw new Error(`Ya existe un tipo de NPC con el nombre \`${name}\`.`);
  }
  if (!Number.isInteger(maxHp) || maxHp < 1) {
    throw new Error('La vida máxima debe ser un número entero positivo.');
  }
  if (spawnChancePercent < 0 || spawnChancePercent > 100) {
    throw new Error('El % de aparición debe estar entre 0 y 100.');
  }
  if (fleeChancePercent < 0 || fleeChancePercent > 100) {
    throw new Error('El % de éxito al huir debe estar entre 0 y 100.');
  }
  if (healThresholdPercent < 0 || healThresholdPercent > 100) {
    throw new Error('El % de vida para curarse debe estar entre 0 y 100.');
  }
  if (theftChancePercent < 0 || theftChancePercent > 100) {
    throw new Error('El % de éxito al robar debe estar entre 0 y 100.');
  }
  if (tradeMarginPercent < 0) {
    throw new Error('El margen de trueque no puede ser negativo.');
  }
  if (surrenderChancePercent < 0 || surrenderChancePercent > 100) {
    throw new Error('El % de perdonar una rendición debe estar entre 0 y 100.');
  }
  if (tameChancePercent < 0 || tameChancePercent > 100) {
    throw new Error('El % de éxito al domesticar debe estar entre 0 y 100.');
  }
  if (vehicleSpeedMultiplier <= 0) {
    throw new Error('El multiplicador de velocidad como montura debe ser mayor que 0.');
  }
  if (breedChancePercent < 0 || breedChancePercent > 100) {
    throw new Error('El % de éxito al criar debe estar entre 0 y 100.');
  }
  _validateVehicleCategory(vehicleCategory);

  const weaponItemId = await _resolveWeaponItemId(weaponItemName);
  const secondaryWeaponItemId = await _resolveWeaponItemId(secondaryWeaponItemName);
  const healItemId = await _resolveHealItemId(healItemName);
  const mountItemId = await _resolveMountItemId(mountItemName);
  const tameBaitItemId = await _resolveBaitItemId(tameBaitItemName);
  const factionId = await _resolveFactionId(factionName);

  const id = await withTransaction(async () => {
    const result = await execute(SQL.insert, [
      name, displayName, emoji, description, maxHp, weaponItemId, spawnChancePercent, isAggressive ? 1 : 0, fleeChancePercent,
      secondaryWeaponItemId, healItemId, healThresholdPercent, mountItemId,
      theftChancePercent, tradeMarginPercent, surrenderChancePercent,
      isTameable ? 1 : 0, tameChancePercent, tameBaitItemId,
      vehicleCategory, vehicleSpeedMultiplier, breedChancePercent, factionId,
    ]);
    const newId = result.lastInsertRowid;
    await _insertTerrains(newId, terrains);
    await _insertDrops(newId, drops);
    return newId;
  });

  logger.info(`[NpcTypes] Tipo creado: "${name}" (${displayName})`);
  return queryOne(SQL.getById, [id]);
}

export async function updateNpcType(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de NPC llamado \`${name}\`.`);

  const map = {
    displayName: 'display_name',
    emoji: 'emoji',
    description: 'description',
  };

  if (updates.maxHp !== undefined && (!Number.isInteger(updates.maxHp) || updates.maxHp < 1)) {
    throw new Error('La vida máxima debe ser un número entero positivo.');
  }
  if (updates.spawnChancePercent !== undefined && (updates.spawnChancePercent < 0 || updates.spawnChancePercent > 100)) {
    throw new Error('El % de aparición debe estar entre 0 y 100.');
  }
  if (updates.fleeChancePercent !== undefined && (updates.fleeChancePercent < 0 || updates.fleeChancePercent > 100)) {
    throw new Error('El % de éxito al huir debe estar entre 0 y 100.');
  }
  if (updates.healThresholdPercent !== undefined && (updates.healThresholdPercent < 0 || updates.healThresholdPercent > 100)) {
    throw new Error('El % de vida para curarse debe estar entre 0 y 100.');
  }
  if (updates.theftChancePercent !== undefined && (updates.theftChancePercent < 0 || updates.theftChancePercent > 100)) {
    throw new Error('El % de éxito al robar debe estar entre 0 y 100.');
  }
  if (updates.tradeMarginPercent !== undefined && updates.tradeMarginPercent < 0) {
    throw new Error('El margen de trueque no puede ser negativo.');
  }
  if (updates.surrenderChancePercent !== undefined && (updates.surrenderChancePercent < 0 || updates.surrenderChancePercent > 100)) {
    throw new Error('El % de perdonar una rendición debe estar entre 0 y 100.');
  }
  if (updates.tameChancePercent !== undefined && (updates.tameChancePercent < 0 || updates.tameChancePercent > 100)) {
    throw new Error('El % de éxito al domesticar debe estar entre 0 y 100.');
  }
  if (updates.vehicleSpeedMultiplier !== undefined && updates.vehicleSpeedMultiplier <= 0) {
    throw new Error('El multiplicador de velocidad como montura debe ser mayor que 0.');
  }
  if (updates.breedChancePercent !== undefined && (updates.breedChancePercent < 0 || updates.breedChancePercent > 100)) {
    throw new Error('El % de éxito al criar debe estar entre 0 y 100.');
  }
  if (updates.vehicleCategory !== undefined) _validateVehicleCategory(updates.vehicleCategory);

  const fields = [];
  const values = [];

  if (updates.weaponItemName !== undefined) {
    fields.push('weapon_item_id = ?');
    values.push(await _resolveWeaponItemId(updates.weaponItemName));
  }
  if (updates.secondaryWeaponItemName !== undefined) {
    fields.push('secondary_weapon_item_id = ?');
    values.push(await _resolveWeaponItemId(updates.secondaryWeaponItemName));
  }
  if (updates.healItemName !== undefined) {
    fields.push('heal_item_id = ?');
    values.push(await _resolveHealItemId(updates.healItemName));
  }
  if (updates.healThresholdPercent !== undefined) { fields.push('heal_threshold_percent = ?'); values.push(updates.healThresholdPercent); }
  if (updates.mountItemName !== undefined) {
    fields.push('mount_item_id = ?');
    values.push(await _resolveMountItemId(updates.mountItemName));
  }
  if (updates.maxHp !== undefined) { fields.push('max_hp = ?'); values.push(updates.maxHp); }
  if (updates.spawnChancePercent !== undefined) { fields.push('spawn_chance_percent = ?'); values.push(updates.spawnChancePercent); }
  if (updates.isAggressive !== undefined) { fields.push('is_aggressive = ?'); values.push(updates.isAggressive ? 1 : 0); }
  if (updates.fleeChancePercent !== undefined) { fields.push('flee_chance_percent = ?'); values.push(updates.fleeChancePercent); }

  if (updates.isRecruitable !== undefined) { fields.push('is_recruitable = ?'); values.push(updates.isRecruitable ? 1 : 0); }
  if (updates.productionIntervalHours !== undefined) { fields.push('production_interval_hours = ?'); values.push(updates.productionIntervalHours); }
  if (updates.maxAccrualHours !== undefined) { fields.push('max_accrual_hours = ?'); values.push(updates.maxAccrualHours); }

  if (updates.canProduce !== undefined) { fields.push('can_produce = ?'); values.push(updates.canProduce ? 1 : 0); }
  if (updates.canSoldier !== undefined) { fields.push('can_soldier = ?'); values.push(updates.canSoldier ? 1 : 0); }

  if (updates.theftChancePercent !== undefined) { fields.push('theft_chance_percent = ?'); values.push(updates.theftChancePercent); }
  if (updates.tradeMarginPercent !== undefined) { fields.push('trade_margin_percent = ?'); values.push(updates.tradeMarginPercent); }
  if (updates.surrenderChancePercent !== undefined) { fields.push('surrender_chance_percent = ?'); values.push(updates.surrenderChancePercent); }

  if (updates.isTameable !== undefined) { fields.push('is_tameable = ?'); values.push(updates.isTameable ? 1 : 0); }
  if (updates.tameChancePercent !== undefined) { fields.push('tame_chance_percent = ?'); values.push(updates.tameChancePercent); }
  if (updates.tameBaitItemName !== undefined) {
    fields.push('tame_bait_item_id = ?');
    values.push(await _resolveBaitItemId(updates.tameBaitItemName));
  }

  if (updates.vehicleCategory !== undefined) { fields.push('vehicle_category = ?'); values.push(updates.vehicleCategory); }
  if (updates.vehicleSpeedMultiplier !== undefined) { fields.push('vehicle_speed_multiplier = ?'); values.push(updates.vehicleSpeedMultiplier); }
  if (updates.breedChancePercent !== undefined) { fields.push('breed_chance_percent = ?'); values.push(updates.breedChancePercent); }

  if (updates.factionName !== undefined) {
    fields.push('faction_id = ?');
    values.push(await _resolveFactionId(updates.factionName));
  }

  for (const [key, column] of Object.entries(map)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(updates[key]);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(name);
  await execute(`UPDATE ${T.npc_types} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[NpcTypes] Tipo "${name}" actualizado: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [name]);
}

export async function deleteNpcType(name) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de NPC llamado \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countInstances, [existing.id]);
  if (cnt > 0) {
    throw new Error(`No se puede eliminar \`${name}\`: hay **${cnt}** NPC(s) de este tipo ya en el mapa.`);
  }

  await withTransaction(async () => {
    await execute(SQL.deleteTerrains, [existing.id]);
    await execute(SQL.deleteZones, [existing.id]);
    await execute(SQL.deleteDrops, [existing.id]);
    await execute(SQL.deleteEquipment, [existing.id]);
    await execute(SQL.delete, [name]);
  });

  logger.info(`[NpcTypes] Tipo eliminado: "${name}"`);
  return existing;
}

async function _insertTerrains(npcTypeId, terrains) {
  for (const entry of terrains) {
    const isPlainName = typeof entry === 'string';
    const terrainName = isPlainName ? entry : entry.name;
    const overridePercent = isPlainName ? null : (entry.overridePercent ?? null);
    if (overridePercent !== null && (overridePercent < 0 || overridePercent > 100)) {
      throw new Error(`El % de aparición para el terreno \`${terrainName}\` debe estar entre 0 y 100.`);
    }
    const terrain = await queryOne(SQL.getTerrainTypeByName, [terrainName.toLowerCase().trim()]);
    if (!terrain) throw new Error(`El tipo de terreno \`${terrainName}\` no existe.`);
    await execute(SQL.insertTerrain, [npcTypeId, terrain.id, overridePercent]);
  }
}

async function _insertZones(npcTypeId, zones) {
  for (const entry of zones) {
    const isPlainName = typeof entry === 'string';
    const zoneName = isPlainName ? entry : entry.name;
    const overridePercent = isPlainName ? null : (entry.overridePercent ?? null);
    if (overridePercent !== null && (overridePercent < 0 || overridePercent > 100)) {
      throw new Error(`El % de aparición para la zona \`${zoneName}\` debe estar entre 0 y 100.`);
    }
    const zone = await queryOne(SQL.getZoneByName, [zoneName.toLowerCase().trim()]);
    if (!zone) throw new Error(`La zona \`${zoneName}\` no existe.`);
    await execute(SQL.insertZone, [npcTypeId, zone.id, overridePercent]);
  }
}

async function _insertDrops(npcTypeId, drops) {
  for (const { name: itemName, quantity, dropChancePercent = 100 } of drops) {
    const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
    if (!item) throw new Error(`El ítem de botín \`${itemName}\` no existe en el catálogo.`);
    if (!(quantity > 0)) throw new Error(`Cantidad inválida para el botín \`${itemName}\`: debe ser un número positivo.`);
    if (dropChancePercent < 0 || dropChancePercent > 100) throw new Error(`% de caída inválido para \`${itemName}\`: debe estar entre 0 y 100.`);
    await execute(SQL.insertDrop, [npcTypeId, item.id, quantity, dropChancePercent]);
  }
}

async function _insertEquipment(npcTypeId, equipment) {
  for (const { name: itemName, quantity } of equipment) {
    const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
    if (!item) throw new Error(`El ítem de equipo \`${itemName}\` no existe en el catálogo.`);
    if (!(quantity > 0)) throw new Error(`Cantidad inválida para el equipo \`${itemName}\`: debe ser un número positivo.`);
    await execute(SQL.insertEquipment, [npcTypeId, item.id, quantity]);
  }
}

export async function getEquipment(npcTypeId) {
  return query(SQL.getEquipment, [npcTypeId]);
}

export async function setNpcTypeEquipment(name, equipment = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de NPC llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteEquipment, [existing.id]);
    await _insertEquipment(existing.id, equipment);
  });

  logger.info(`[NpcTypes] Equipo requerido de "${name}" reemplazado (${equipment.length} línea(s))`);
  return query(SQL.getEquipment, [existing.id]);
}

export async function listRecruitableNpcTypes() {
  return query(SQL.listRecruitable);
}

export async function getTerrains(npcTypeId) {
  return query(SQL.getTerrains, [npcTypeId]);
}

export async function setNpcTypeTerrains(name, terrainNames = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de NPC llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteTerrains, [existing.id]);
    await _insertTerrains(existing.id, terrainNames);
  });

  logger.info(`[NpcTypes] Terrenos de "${name}" reemplazados (${terrainNames.length})`);
  return query(SQL.getTerrains, [existing.id]);
}

export async function getZones(npcTypeId) {
  return query(SQL.getZones, [npcTypeId]);
}

export async function setNpcTypeZones(name, zoneNames = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de NPC llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteZones, [existing.id]);
    await _insertZones(existing.id, zoneNames);
  });

  logger.info(`[NpcTypes] Zonas de "${name}" reemplazadas (${zoneNames.length})`);
  return query(SQL.getZones, [existing.id]);
}

export async function getDrops(npcTypeId) {
  return query(SQL.getDrops, [npcTypeId]);
}

export async function setNpcTypeDrops(name, drops = []) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ningún tipo de NPC llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteDrops, [existing.id]);
    await _insertDrops(existing.id, drops);
  });

  logger.info(`[NpcTypes] Botín de "${name}" reemplazado (${drops.length} línea(s))`);
  return query(SQL.getDrops, [existing.id]);
}

export async function setNpcTypeImage(name, imageFilename) {
  await execute(SQL.setImage, [imageFilename, name]);
  return queryOne(SQL.getByName, [name]);
}
