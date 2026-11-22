import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { resolvePermission } from './permissionService.js';
import { hasEnough, removeItem, addItem } from './inventoryService.js';

const SQL = {
  getContents: `
    SELECT cs.item_id, cs.quantity, i.name, i.display_name, i.emoji, i.weight
    FROM ${T.construction_storage} cs
    JOIN ${T.items} i ON cs.item_id = i.id
    WHERE cs.construction_id = ?
    ORDER BY i.display_name ASC
  `,
  getItemByName: `SELECT id, name, display_name, emoji, weight FROM ${T.items} WHERE name = ?`,
  getRow: `SELECT quantity FROM ${T.construction_storage} WHERE construction_id = ? AND item_id = ?`,
  upsertAdd: `
    INSERT INTO ${T.construction_storage} (construction_id, item_id, quantity)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
  `,
  setQuantity: `UPDATE ${T.construction_storage} SET quantity = ? WHERE construction_id = ? AND item_id = ?`,

  subtract: `UPDATE ${T.construction_storage} SET quantity = quantity - ? WHERE construction_id = ? AND item_id = ? AND quantity >= ?`,
};

async function totalWeight(constructionId) {
  const rows = await query(SQL.getContents, [constructionId]);
  return rows.reduce((sum, r) => sum + r.quantity * r.weight, 0);
}

export async function getStorageContents(constructionId) {
  return query(SQL.getContents, [constructionId]);
}

export async function addToStorage(constructionId, itemName, quantity, capacity = null) {
  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);

  return withTransaction(async () => {
    const room = capacity != null
      ? Math.max(0, (capacity - await totalWeight(constructionId)) / (item.weight || 1))
      : Infinity;
    const added = Math.min(quantity, room);
    const overflow = quantity - added;

    if (added > 0) {
      await execute(SQL.upsertAdd, [constructionId, item.id, added]);
    }
    const row = await queryOne(SQL.getRow, [constructionId, item.id]);
    return { added, overflow, newQuantity: row?.quantity ?? 0 };
  });
}

export async function depositItem(discordId, construction, itemName, quantity, actor = {}) {
  if (!(quantity > 0)) throw new UserFacingError('La cantidad a depositar debe ser mayor que 0.');

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const result = await resolvePermission({ discordId, isRolepriest: Boolean(actor.isRolepriest) }, scope, 'construction.storage_deposit', 'owner');
  if (!result.allowed) {
    throw new UserFacingError(`No puedes depositar en **${construction.name}** — ${result.reason}.`);
  }

  if (!(await hasEnough(discordId, itemName, quantity))) {
    throw new UserFacingError(`No tienes **${quantity}** de **${itemName}** en tu inventario.`);
  }

  const capacity = construction.storage_capacity ?? null;
  let outcome;
  await withTransaction(async () => {
    await removeItem(discordId, itemName, quantity);
    outcome = await addToStorage(construction.id, itemName, quantity, capacity);
    if (outcome.overflow > 0) {
      await addItem(discordId, itemName, outcome.overflow);
    }
  });
  return outcome;
}

export async function withdrawItem(discordId, construction, itemName, quantity, actor = {}) {
  if (!(quantity > 0)) throw new UserFacingError('La cantidad a retirar debe ser mayor que 0.');

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const result = await resolvePermission({ discordId, isRolepriest: Boolean(actor.isRolepriest) }, scope, 'construction.storage_withdraw', 'owner');
  if (!result.allowed) {
    throw new UserFacingError(`No puedes retirar de **${construction.name}** — ${result.reason}.`);
  }

  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);
  const row = await queryOne(SQL.getRow, [construction.id, item.id]);
  const available = row?.quantity ?? 0;
  if (available < quantity) {
    throw new UserFacingError(`El almacén de **${construction.name}** solo tiene **${available}** de **${item.display_name}**.`);
  }

  let remaining;
  await withTransaction(async () => {
    const subtractResult = await execute(SQL.subtract, [quantity, construction.id, item.id, quantity]);
    if (subtractResult.changes === 0) {
      throw new UserFacingError(`El almacén de **${construction.name}** ya no tiene suficiente de **${item.display_name}**.`);
    }
    await addItem(discordId, item.name, quantity);
    remaining = (await queryOne(SQL.getRow, [construction.id, item.id]))?.quantity ?? 0;
  });

  return { withdrawn: quantity, remaining };
}

export async function consumeFromStorage(constructionId, itemId, quantity) {
  const row = await queryOne(SQL.getRow, [constructionId, itemId]);
  const available = row?.quantity ?? 0;
  if (available < quantity) {
    throw new UserFacingError(`El almacén de la construcción no tiene suficiente de ese ítem (tiene ${available}, hacen falta ${quantity}).`);
  }
  const result = await execute(SQL.subtract, [quantity, constructionId, itemId, quantity]);
  if (result.changes === 0) {
    throw new UserFacingError('El almacén de la construcción ya no tiene suficiente de ese ítem.');
  }
}
