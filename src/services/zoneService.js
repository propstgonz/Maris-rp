import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { normalizeRange } from './mapService.js';
import {
  getWorldTemperatureRange, regenerateTemperaturesForRange, regenerateZoneTemperatures,
} from './temperatureService.js';
import { validateTemperatureRange } from '../utils/temperature.js';

const SQL = {
  getByName: `SELECT * FROM ${T.zones} WHERE name = ?`,
  getById:   `SELECT * FROM ${T.zones} WHERE id = ?`,
  list: `
    SELECT z.*, (SELECT COUNT(*) FROM ${T.map_tiles} t WHERE t.zone_id = z.id) AS tile_count
    FROM ${T.zones} z
    ORDER BY z.display_name ASC
  `,

  insert: `
    INSERT INTO ${T.zones} (name, display_name, emoji, color, description, temp_min, temp_max)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  countTilesUsing: `SELECT COUNT(*) AS cnt FROM ${T.map_tiles} WHERE zone_id = ?`,

  delete: `DELETE FROM ${T.zones} WHERE name = ?`,

  getItemByName: `SELECT id, name, display_name FROM ${T.items} WHERE name = ?`,

  insertResource: `
    INSERT INTO ${T.zone_resources} (zone_id, item_id, quantity, drop_chance_percent) VALUES (?, ?, ?, ?)
  `,
  getResources: `
    SELECT zr.id, zr.quantity, zr.drop_chance_percent, i.name, i.display_name, i.emoji
    FROM ${T.zone_resources} zr JOIN ${T.items} i ON zr.item_id = i.id
    WHERE zr.zone_id = ?
    ORDER BY zr.drop_chance_percent DESC
  `,
  deleteResources: `DELETE FROM ${T.zone_resources} WHERE zone_id = ?`,

  assignRange: `
    UPDATE ${T.map_tiles} SET zone_id = ?
    WHERE coord_x BETWEEN ? AND ? AND coord_y BETWEEN ? AND ?
  `,
  unassignRange: `
    UPDATE ${T.map_tiles} SET zone_id = NULL
    WHERE coord_x BETWEEN ? AND ? AND coord_y BETWEEN ? AND ?
  `,
  countTilesInRange: `
    SELECT COUNT(*) AS cnt FROM ${T.map_tiles}
    WHERE coord_x BETWEEN ? AND ? AND coord_y BETWEEN ? AND ?
  `,
};

async function _insertResources(zoneId, resources) {
  for (const { name: itemName, quantity, dropChancePercent } of resources) {
    const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
    if (!item) throw new Error(`El ítem de recurso \`${itemName}\` no existe en el catálogo.`);
    if (!(quantity > 0)) throw new Error(`Cantidad inválida para el recurso \`${itemName}\`: debe ser un número positivo.`);
    if (!(dropChancePercent > 0) || dropChancePercent > 100) {
      throw new Error(`% de recolección inválido para \`${itemName}\`: debe estar entre 0 (excluido) y 100.`);
    }
    await execute(SQL.insertResource, [zoneId, item.id, quantity, dropChancePercent]);
  }
}

function _validateColor(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new Error('`color` debe ser un hex de 6 dígitos, ej. `#3B82F6`.');
  }
}

export async function listZones() {
  return query(SQL.list);
}

export async function getZoneByName(name) {
  return (await queryOne(SQL.getByName, [name?.toLowerCase().trim()])) ?? null;
}

export async function getZoneById(id) {
  if (id == null) return null;
  return (await queryOne(SQL.getById, [id])) ?? null;
}

export async function createZone({ name, displayName, emoji = '🧭', color = '#888888', description = '', tempMin, tempMax }) {
  const key = name.toLowerCase().trim();
  if (await queryOne(SQL.getByName, [key])) {
    throw new Error(`Ya existe una zona con el nombre \`${key}\`.`);
  }
  _validateColor(color);

  const world = await getWorldTemperatureRange();
  const range = validateTemperatureRange(tempMin ?? world.tempMin, tempMax ?? world.tempMax);

  const result = await execute(SQL.insert, [key, displayName, emoji, color, description, range.tempMin, range.tempMax]);
  logger.info(`[Zones] Zona creada: "${key}" (${displayName})`);
  return queryOne(SQL.getById, [result.lastInsertRowid]);
}

export async function updateZone(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ninguna zona llamada \`${name}\`.`);

  const fields = [];
  const values = [];

  if (updates.displayName !== undefined) { fields.push('display_name = ?'); values.push(updates.displayName); }
  if (updates.emoji !== undefined)       { fields.push('emoji = ?');        values.push(updates.emoji); }
  if (updates.description !== undefined) { fields.push('description = ?');  values.push(updates.description); }
  if (updates.color !== undefined) {
    _validateColor(updates.color);
    fields.push('color = ?'); values.push(updates.color);
  }

  const temperatureChanged = updates.tempMin !== undefined || updates.tempMax !== undefined;
  if (temperatureChanged) {
    const range = validateTemperatureRange(
      updates.tempMin ?? existing.temp_min,
      updates.tempMax ?? existing.temp_max
    );
    fields.push('temp_min = ?'); values.push(range.tempMin);
    fields.push('temp_max = ?'); values.push(range.tempMax);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(existing.name);
  await execute(`UPDATE ${T.zones} SET ${fields.join(', ')} WHERE name = ?`, values);

  if (temperatureChanged) await regenerateZoneTemperatures(existing.id);

  logger.info(`[Zones] Zona "${existing.name}" actualizada: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [existing.name]);
}

export async function deleteZone(name) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ninguna zona llamada \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countTilesUsing, [existing.id]);
  if (cnt > 0) {
    throw new Error(`No se puede eliminar \`${name}\`: hay **${cnt}** casilla(s) asignada(s). Libéralas primero con \`/zona desasignar\`.`);
  }

  await execute(SQL.delete, [existing.name]);
  logger.info(`[Zones] Zona eliminada: "${existing.name}"`);
  return existing;
}

export async function getZoneResources(zoneId) {
  if (zoneId == null) return [];
  return query(SQL.getResources, [zoneId]);
}

export async function setZoneResources(name, resources = []) {
  const existing = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!existing) throw new Error(`No existe ninguna zona llamada \`${name}\`.`);

  await withTransaction(async () => {
    await execute(SQL.deleteResources, [existing.id]);
    await _insertResources(existing.id, resources);
  });

  logger.info(`[Zones] Recursos de "${existing.name}" reemplazados (${resources.length} línea(s))`);
  return query(SQL.getResources, [existing.id]);
}

export async function assignRange(name, x1, y1, x2, y2) {
  const zone = await queryOne(SQL.getByName, [name.toLowerCase().trim()]);
  if (!zone) throw new Error(`No existe ninguna zona llamada \`${name}\`.`);

  const { minX, maxX, minY, maxY } = normalizeRange(x1, y1, x2, y2);
  const { cnt } = await queryOne(SQL.countTilesInRange, [minX, maxX, minY, maxY]);
  if (cnt === 0) {
    throw new Error(`No hay ninguna casilla creada en el rango (${minX},${minY})-(${maxX},${maxY}).`);
  }

  const info = await execute(SQL.assignRange, [zone.id, minX, maxX, minY, maxY]);
  await regenerateTemperaturesForRange(minX, minY, maxX, maxY);
  logger.info(`[Zones] "${zone.name}" asignada a ${info.changes} casilla(s) en (${minX},${minY})-(${maxX},${maxY})`);
  return { zone, tilesAffected: info.changes, minX, maxX, minY, maxY };
}

export async function unassignRange(x1, y1, x2, y2) {
  const { minX, maxX, minY, maxY } = normalizeRange(x1, y1, x2, y2);
  const info = await execute(SQL.unassignRange, [minX, maxX, minY, maxY]);
  await regenerateTemperaturesForRange(minX, minY, maxX, maxY);
  logger.info(`[Zones] Zona retirada de ${info.changes} casilla(s) en (${minX},${minY})-(${maxX},${maxY})`);
  return { tilesAffected: info.changes, minX, maxX, minY, maxY };
}
