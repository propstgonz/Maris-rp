import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const VEHICLE_CATEGORIES = ['aereo', 'maritimo', 'terrestre'];

const SQL = {
  getByName: `SELECT * FROM ${T.terrain_types} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.terrain_types} WHERE id = ?`,
  list:      `SELECT * FROM ${T.terrain_types} ORDER BY display_name ASC`,

  insert: `
    INSERT INTO ${T.terrain_types} (name, display_name, emoji, color, requires_vehicle_category, description, movement_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  countTilesUsing: `SELECT COUNT(*) AS cnt FROM ${T.map_tiles} WHERE terrain_type_id = ?`,

  delete: `DELETE FROM ${T.terrain_types} WHERE name = ?`,

  getItemByName: `SELECT id, name, display_name FROM ${T.items} WHERE name = ?`,

  insertResource: `
    INSERT INTO ${T.terrain_type_resources} (terrain_type_id, item_id, quantity, drop_chance_percent) VALUES (?, ?, ?, ?)
  `,
  getResources: `
    SELECT ttr.id, ttr.quantity, ttr.drop_chance_percent, i.name, i.display_name, i.emoji
    FROM ${T.terrain_type_resources} ttr JOIN ${T.items} i ON ttr.item_id = i.id
    WHERE ttr.terrain_type_id = ?
    ORDER BY ttr.drop_chance_percent DESC
  `,
  deleteResources: `DELETE FROM ${T.terrain_type_resources} WHERE terrain_type_id = ?`,
};

async function _insertResources(terrainTypeId, resources) {
  for (const { name: itemName, quantity, dropChancePercent } of resources) {
    const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
    if (!item) throw new Error(`El ítem de recurso \`${itemName}\` no existe en el catálogo.`);
    if (!(quantity > 0)) throw new Error(`Cantidad inválida para el recurso \`${itemName}\`: debe ser un número positivo.`);
    if (!(dropChancePercent > 0) || dropChancePercent > 100) {
      throw new Error(`% de recolección inválido para \`${itemName}\`: debe estar entre 0 (excluido) y 100.`);
    }
    await execute(SQL.insertResource, [terrainTypeId, item.id, quantity, dropChancePercent]);
  }
}

function _validateVehicleCategory(category) {
  if (category === undefined || category === null) return;
  if (!VEHICLE_CATEGORIES.includes(category)) {
    throw new Error(`\`vehiculo_categoria\` debe ser una de: ${VEHICLE_CATEGORIES.join(', ')} (o vacío para "sin requisito").`);
  }
}

function _validateMovementCost(cost) {
  if (cost === undefined) return;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
    throw new Error('`coste_movimiento` debe ser un número mayor que 0.');
  }
}

export async function listTerrainTypes() {
  return query(SQL.list);
}

export async function getTerrainTypeByName(name) {
  return (await queryOne(SQL.getByName, [name?.toLowerCase().trim()])) ?? null;
}

export async function getTerrainTypeById(id) {
  if (id == null) return null;
  return (await queryOne(SQL.getById, [id])) ?? null;
}

export async function createTerrainType({
  name, displayName, emoji = '🗺️', color = '#888888',
  requiresVehicleCategory = null, description = '', movementCost = 1,
}) {
  const key = name.toLowerCase().trim();
  if (await queryOne(SQL.getByName, [key])) {
    throw new Error(`Ya existe un tipo de terreno con el nombre \`${key}\`.`);
  }
  _validateVehicleCategory(requiresVehicleCategory);
  _validateMovementCost(movementCost);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error('`color` debe ser un hex de 6 dígitos, ej. `#3B82F6`.');
  }

  const result = await execute(SQL.insert, [key, displayName, emoji, color, requiresVehicleCategory, description, movementCost]);
  logger.info(`[TerrainTypes] Tipo creado: "${key}" (${displayName})`);
  return queryOne(SQL.getById, [result.lastInsertRowid]);
}

export async function updateTerrainType(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ningún tipo de terreno llamado \`${name}\`.`);

  const fields = [];
  const values = [];

  if (updates.displayName !== undefined) { fields.push('display_name = ?'); values.push(updates.displayName); }
  if (updates.emoji !== undefined)       { fields.push('emoji = ?');        values.push(updates.emoji); }
  if (updates.color !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(updates.color)) {
      throw new Error('`color` debe ser un hex de 6 dígitos, ej. `#3B82F6`.');
    }
    fields.push('color = ?'); values.push(updates.color);
  }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.requiresVehicleCategory !== undefined) {
    _validateVehicleCategory(updates.requiresVehicleCategory);
    fields.push('requires_vehicle_category = ?');
    values.push(updates.requiresVehicleCategory);
  }
  if (updates.movementCost !== undefined) {
    _validateMovementCost(updates.movementCost);
    fields.push('movement_cost = ?');
    values.push(updates.movementCost);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(existing.name);
  await execute(`UPDATE ${T.terrain_types} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[TerrainTypes] Tipo "${existing.name}" actualizado: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [existing.name]);
}

export async function deleteTerrainType(name) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ningún tipo de terreno llamado \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countTilesUsing, [existing.id]);
  if (cnt > 0) {
    throw new Error(`No se puede eliminar \`${name}\`: hay **${cnt}** casilla(s) usándolo. Cámbialas de tipo con \`/map edit\` primero.`);
  }

  await execute(SQL.delete, [name.toLowerCase().trim()]);
  logger.info(`[TerrainTypes] Tipo eliminado: "${existing.name}"`);
  return existing;
}

export async function getResources(terrainTypeId) {
  return query(SQL.getResources, [terrainTypeId]);
}

export async function setTerrainResources(name, resources = []) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ningún tipo de terreno llamado \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteResources, [existing.id]);
    await _insertResources(existing.id, resources);
  });

  logger.info(`[TerrainTypes] Recursos de "${existing.name}" reemplazados (${resources.length} línea(s))`);
  return query(SQL.getResources, [existing.id]);
}
