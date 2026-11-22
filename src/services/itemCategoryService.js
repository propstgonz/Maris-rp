import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  getByName: `SELECT * FROM ${T.item_categories} WHERE name = ?`,

  list: `SELECT * FROM ${T.item_categories} ORDER BY display_name ASC`,

  insert: `INSERT INTO ${T.item_categories} (name, display_name, emoji, description) VALUES (?, ?, ?, ?)`,

  countItemReferences: `SELECT COUNT(*) AS cnt FROM ${T.items} WHERE category_name = ?`,

  clearFromItems: `UPDATE ${T.items} SET category_name = NULL WHERE category_name = ?`,

  delete: `DELETE FROM ${T.item_categories} WHERE name = ?`,
};

export async function listItemCategories() {
  return query(SQL.list);
}

export async function getItemCategory(name) {
  return (await queryOne(SQL.getByName, [name])) ?? null;
}

export async function createItemCategory({ name, displayName, emoji = '🏷️', description = '' }) {
  if (await queryOne(SQL.getByName, [name])) {
    throw new Error(`Ya existe una categoría de ítems con el nombre \`${name}\`. Elige un nombre diferente.`);
  }

  await execute(SQL.insert, [name, displayName, emoji, description]);
  logger.info(`[ItemCategories] Categoría creada: "${name}" (${displayName})`);

  return queryOne(SQL.getByName, [name]);
}

export async function updateItemCategory(name, updates = {}) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ninguna categoría de ítems llamada \`${name}\`.`);

  const fields = [];
  const values = [];
  const map = { displayName: 'display_name', emoji: 'emoji', description: 'description' };

  for (const [key, column] of Object.entries(map)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(updates[key]);
  }

  if (fields.length === 0) {
    throw new Error('Debes especificar al menos un campo para editar.');
  }

  values.push(name);
  await execute(`UPDATE ${T.item_categories} SET ${fields.join(', ')} WHERE name = ?`, values);

  logger.info(`[ItemCategories] Categoría "${name}" actualizada: ${fields.join(', ')}`);
  return queryOne(SQL.getByName, [name]);
}

export async function deleteItemCategory(name) {
  const existing = await queryOne(SQL.getByName, [name]);
  if (!existing) throw new Error(`No existe ninguna categoría de ítems llamada \`${name}\`.`);

  const { cnt } = await queryOne(SQL.countItemReferences, [name]);
  if (cnt > 0) await execute(SQL.clearFromItems, [name]);

  await execute(SQL.delete, [name]);
  logger.info(`[ItemCategories] Categoría eliminada: "${name}"${cnt > 0 ? ` (${cnt} ítem(s) quedaron sin categoría)` : ''}`);

  return { ...existing, itemsUncategorized: cnt };
}
