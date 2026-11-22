import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { logAction } from './auditLogService.js';
import { slugify } from '../utils/text.js';
import { UserFacingError } from '../utils/errors.js';

const MAX_QUANTITY = 999999999999.99;
const NAME_MAX = 191;
const EMOJI_MAX = 32;
const DESCRIPTION_MAX = 2000;
const DEFAULT_TYPE_EMOJI = '📦';
const DEFAULT_CATEGORY_EMOJI = '🏷️';

const SQL = {
  listCategories: `SELECT id, name, display_name, emoji, description FROM ${T.item_categories} ORDER BY display_name ASC`,
  findCategory: `SELECT id, name, display_name FROM ${T.item_categories} WHERE name = ? OR display_name = ? LIMIT 1`,
  insertCategory: `INSERT INTO ${T.item_categories} (name, display_name, emoji, description) VALUES (?, ?, ?, ?)`,
  typeSelect: `
    SELECT i.id, i.name, i.display_name, i.emoji, i.description, i.is_active, i.category_id,
           c.name AS category_name, c.display_name AS category
    FROM ${T.items} i LEFT JOIN ${T.item_categories} c ON c.id = i.category_id
  `,
  insertType: `INSERT INTO ${T.items} (name, display_name, category_id, emoji, description) VALUES (?, ?, ?, ?, ?)`,
  setActive: `UPDATE ${T.items} SET is_active = ? WHERE id = ?`,
  alivePlayer: `SELECT id FROM ${T.players} WHERE id = ? AND is_alive = 1`,
  lockPlayers: `SELECT id, is_alive FROM ${T.players} WHERE id IN (?, ?) ORDER BY id ASC FOR UPDATE`,
  upsert: `
    INSERT INTO ${T.inventory} (player_id, item_id, quantity) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
  `,
  takeExact: `DELETE FROM ${T.inventory} WHERE player_id = ? AND item_id = ? AND quantity = ?`,
  takePartial: `UPDATE ${T.inventory} SET quantity = quantity - ? WHERE player_id = ? AND item_id = ? AND quantity > ?`,
  getQuantity: `SELECT quantity FROM ${T.inventory} WHERE player_id = ? AND item_id = ?`,
  countInventory: `SELECT COUNT(*) AS total FROM ${T.inventory} WHERE player_id = ?`,
};

function _positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function _validateText(value, label, max, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new UserFacingError(`${label} es obligatorio.`);
    return null;
  }
  const text = String(value).trim();
  if (required && !text) throw new UserFacingError(`${label} es obligatorio.`);
  if (text.length > max) throw new UserFacingError(`${label} no puede pasar de ${max} caracteres.`);
  return text || null;
}

export function validateQuantity(quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new UserFacingError('La cantidad debe ser mayor que 0.');
  if (q > MAX_QUANTITY) throw new UserFacingError('La cantidad es demasiado grande.');
  if (Math.abs(q * 100 - Math.round(q * 100)) > 1e-6) throw new UserFacingError('La cantidad admite como mucho 2 decimales.');
  return Math.round(q * 100) / 100;
}

function _isDuplicate(err) {
  return err?.code === 'ER_DUP_ENTRY';
}

function _isOutOfRange(err) {
  return err?.code === 'ER_WARN_DATA_OUT_OF_RANGE' || err?.errno === 1264;
}

function _isDeadlock(err) {
  return err?.code === 'ER_LOCK_DEADLOCK';
}

function _mapType(row) {
  return row ? { ...row, is_active: Boolean(row.is_active) } : row;
}

async function _getType(itemId) {
  return _mapType(await queryOne(`${SQL.typeSelect} WHERE i.id = ?`, [itemId]));
}

async function _requireActiveType(itemId) {
  const type = await _getType(itemId);
  if (!type) throw new UserFacingError('Ese tipo de bien no existe.');
  if (!type.is_active) throw new UserFacingError(`El bien **${type.display_name}** está desactivado.`);
  return type;
}

async function _resolveCategoryId(categoryName) {
  if (categoryName == null || categoryName === '') return null;
  const category = await queryOne(SQL.findCategory, [categoryName, categoryName]);
  if (!category) throw new UserFacingError(`La categoría **${categoryName}** no existe.`);
  return category.id;
}

async function _quantityOf(ownerId, itemId) {
  const row = await queryOne(SQL.getQuantity, [ownerId, itemId]);
  return row ? Number(row.quantity) : 0;
}

async function _addInTx(ownerId, itemId, quantity) {
  try {
    await execute(SQL.upsert, [ownerId, itemId, quantity]);
  } catch (err) {
    if (_isOutOfRange(err)) throw new UserFacingError('El inventario no puede acumular tanta cantidad de ese bien.');
    throw err;
  }
}

async function _takeInTx(ownerId, itemId, quantity) {
  const exact = await execute(SQL.takeExact, [ownerId, itemId, quantity]);
  if (exact.changes > 0) return;
  const partial = await execute(SQL.takePartial, [quantity, ownerId, itemId, quantity]);
  if (partial.changes > 0) return;
  const type = await _getType(itemId);
  const have = await _quantityOf(ownerId, itemId);
  throw new UserFacingError(`No hay suficiente **${type?.display_name ?? 'bien'}**: se necesitan ${quantity} y solo hay ${have}.`);
}

function _audit(actor, action, target, details) {
  return logAction({
    source: actor.source,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    action,
    target,
    details,
  });
}

export async function listCategories() {
  return query(SQL.listCategories);
}

export async function createCategory({ name, displayName, emoji, description }, actor) {
  const display = _validateText(displayName, 'El nombre', NAME_MAX, { required: true });
  const slug = _validateText(name ?? slugify(display), 'El identificador', NAME_MAX, { required: true });
  const row = {
    name: slug,
    displayName: display,
    emoji: _validateText(emoji, 'El emoji', EMOJI_MAX) ?? DEFAULT_CATEGORY_EMOJI,
    description: _validateText(description, 'La descripción', DESCRIPTION_MAX),
  };
  let result;
  try {
    result = await execute(SQL.insertCategory, [row.name, row.displayName, row.emoji, row.description]);
  } catch (err) {
    if (_isDuplicate(err)) throw new UserFacingError(`Ya existe una categoría llamada **${display}**.`);
    throw err;
  }
  await _audit(actor, 'bienes.categoria_creada', row.name, { displayName: row.displayName });
  return { id: result.lastInsertRowid, ...row };
}

export async function listTypes({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE i.is_active = 1';
  const rows = await query(`${SQL.typeSelect} ${where} ORDER BY c.display_name ASC, i.display_name ASC`);
  return rows.map(_mapType);
}

export async function findTypeByName(name) {
  const text = String(name ?? '').trim();
  if (!text) return undefined;
  return _mapType(await queryOne(`${SQL.typeSelect} WHERE i.name = ? OR i.display_name = ? LIMIT 1`, [text, text]));
}

export async function searchTypes(text, limit = 25) {
  const like = `%${String(text ?? '').trim().replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const safeLimit = Math.min(_positiveInt(limit, 25), 100);
  const rows = await query(
    `${SQL.typeSelect} WHERE i.is_active = 1 AND (i.display_name LIKE ? ESCAPE '\\\\' OR i.name LIKE ? ESCAPE '\\\\')
     ORDER BY i.display_name ASC LIMIT ${safeLimit}`,
    [like, like]
  );
  return rows.map(_mapType);
}

export async function createType({ name, displayName, categoryName, emoji, description }, actor) {
  const display = _validateText(displayName, 'El nombre', NAME_MAX, { required: true });
  const slug = _validateText(name ?? slugify(display), 'El identificador', NAME_MAX, { required: true });
  const categoryId = await _resolveCategoryId(categoryName);
  const finalEmoji = _validateText(emoji, 'El emoji', EMOJI_MAX) ?? DEFAULT_TYPE_EMOJI;
  const finalDescription = _validateText(description, 'La descripción', DESCRIPTION_MAX);
  let result;
  try {
    result = await execute(SQL.insertType, [slug, display, categoryId, finalEmoji, finalDescription]);
  } catch (err) {
    if (_isDuplicate(err)) throw new UserFacingError(`Ya existe un bien llamado **${display}**.`);
    throw err;
  }
  await _audit(actor, 'bienes.tipo_creado', slug, { displayName: display, category: categoryName ?? null });
  return _getType(result.lastInsertRowid);
}

export async function editType(id, { displayName, categoryName, emoji, description }, actor) {
  const type = await _getType(id);
  if (!type) throw new UserFacingError('Ese tipo de bien no existe.');
  const sets = [];
  const params = [];
  if (displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(_validateText(displayName, 'El nombre', NAME_MAX, { required: true }));
  }
  if (categoryName !== undefined) {
    sets.push('category_id = ?');
    params.push(await _resolveCategoryId(categoryName));
  }
  if (emoji !== undefined) {
    sets.push('emoji = ?');
    params.push(_validateText(emoji, 'El emoji', EMOJI_MAX) ?? DEFAULT_TYPE_EMOJI);
  }
  if (description !== undefined) {
    sets.push('description = ?');
    params.push(_validateText(description, 'La descripción', DESCRIPTION_MAX));
  }
  if (sets.length === 0) return type;
  await execute(`UPDATE ${T.items} SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
  await _audit(actor, 'bienes.tipo_editado', type.name, { displayName, categoryName, emoji, description });
  return _getType(id);
}

export async function setTypeActive(id, isActive, actor) {
  const type = await _getType(id);
  if (!type) throw new UserFacingError('Ese tipo de bien no existe.');
  await execute(SQL.setActive, [isActive ? 1 : 0, id]);
  await _audit(actor, isActive ? 'bienes.tipo_activado' : 'bienes.tipo_desactivado', type.name);
  return { ...type, is_active: Boolean(isActive) };
}

export async function listInventory(ownerId, { page = 1, pageSize = 10 } = {}) {
  const safePageSize = Math.min(_positiveInt(pageSize, 10), 100);
  const offset = (_positiveInt(page, 1) - 1) * safePageSize;
  const rows = await query(
    `SELECT inv.item_id, i.display_name, i.emoji, c.display_name AS category, inv.quantity
     FROM ${T.inventory} inv
     JOIN ${T.items} i ON i.id = inv.item_id
     LEFT JOIN ${T.item_categories} c ON c.id = i.category_id
     WHERE inv.player_id = ?
     ORDER BY (c.display_name IS NULL), c.display_name ASC, i.display_name ASC
     LIMIT ${safePageSize} OFFSET ${offset}`,
    [ownerId]
  );
  const { total } = await queryOne(SQL.countInventory, [ownerId]);
  return { rows: rows.map(r => ({ ...r, quantity: Number(r.quantity) })), total: Number(total) };
}

export async function addGoods(ownerId, itemId, quantity, actor) {
  const qty = validateQuantity(quantity);
  const result = await withTransaction(async () => {
    if (!(await queryOne(SQL.alivePlayer, [ownerId]))) throw new UserFacingError('Ese jugador no tiene un personaje vivo.');
    const type = await _requireActiveType(itemId);
    await _addInTx(ownerId, itemId, qty);
    return { type, quantity: await _quantityOf(ownerId, itemId) };
  });
  await _audit(actor, 'bienes.alta', String(ownerId), { itemId, item: result.type.name, quantity: qty, total: result.quantity });
  return result.quantity;
}

export async function removeGoods(ownerId, itemId, quantity, actor) {
  const qty = validateQuantity(quantity);
  const result = await withTransaction(async () => {
    const type = await _getType(itemId);
    if (!type) throw new UserFacingError('Ese tipo de bien no existe.');
    await _takeInTx(ownerId, itemId, qty);
    return { type, quantity: await _quantityOf(ownerId, itemId) };
  });
  await _audit(actor, 'bienes.baja', String(ownerId), { itemId, item: result.type.name, quantity: qty, remaining: result.quantity });
  return result.quantity;
}

export async function transferGoodsInTx(fromId, toId, itemId, quantity) {
  const qty = validateQuantity(quantity);
  if (Number(fromId) === Number(toId)) throw new UserFacingError('El origen y el destino no pueden ser el mismo personaje.');
  const players = await query(SQL.lockPlayers, [fromId, toId]);
  const to = players.find(p => p.id === Number(toId));
  if (!to || !to.is_alive) throw new UserFacingError('El destinatario no tiene un personaje vivo.');
  const type = await _requireActiveType(itemId);
  await _takeInTx(fromId, itemId, qty);
  await _addInTx(toId, itemId, qty);
  return { item: type.name, displayName: type.display_name, quantity: qty };
}

export async function adminTransferGoods(fromId, toId, itemId, quantity, actor) {
  let result;
  try {
    result = await withTransaction(() => transferGoodsInTx(fromId, toId, itemId, quantity));
  } catch (err) {
    if (_isDeadlock(err)) throw new UserFacingError('Otra operación está tocando esos bienes. Inténtalo de nuevo.');
    throw err;
  }
  await _audit(actor, 'bienes.traspaso', String(fromId), { toId, itemId, item: result.item, quantity: result.quantity });
  return result;
}
