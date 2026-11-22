import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { resolvePermission } from './permissionService.js';
import { hasEnough, removeItem, addItem } from './inventoryService.js';
import { chebyshevGridDistance } from '../utils/geometry.js';

const SQL = {
  getContents: `
    SELECT fs.item_id, fs.quantity, i.name, i.display_name, i.emoji, i.weight
    FROM ${T.faction_storage} fs
    JOIN ${T.items} i ON fs.item_id = i.id
    WHERE fs.faction_id = ?
    ORDER BY i.display_name ASC
  `,
  getItemByName: `SELECT id, name, display_name, emoji, weight FROM ${T.items} WHERE name = ?`,
  getRow: `SELECT quantity FROM ${T.faction_storage} WHERE faction_id = ? AND item_id = ?`,
  upsertAdd: `
    INSERT INTO ${T.faction_storage} (faction_id, item_id, quantity)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
  `,
  setQuantity: `UPDATE ${T.faction_storage} SET quantity = ? WHERE faction_id = ? AND item_id = ?`,

  subtract: `UPDATE ${T.faction_storage} SET quantity = quantity - ? WHERE faction_id = ? AND item_id = ? AND quantity >= ?`,
  getNearbySilos: `
    SELECT t.coord_x, t.coord_y
    FROM ${T.constructions} c
    JOIN ${T.construction_types} ct ON c.construction_type_id = ct.id
    JOIN ${T.map_tiles} t ON c.tile_id = t.id
    WHERE ct.is_resource_silo = 1 AND t.faction_id = ?
  `,
};

export async function hasNearbySilo(factionId, tile) {
  if (!factionId) return false;
  const silos = await query(SQL.getNearbySilos, [factionId]);
  return silos.some(s => chebyshevGridDistance(tile, s) <= 2);
}

export async function getStorageContents(factionId) {
  return query(SQL.getContents, [factionId]);
}

export async function getStorageContentsMap(factionId) {
  const rows = await getStorageContents(factionId);
  return new Map(rows.map(r => [r.item_id, r.quantity]));
}

export async function addToStorage(factionId, itemName, quantity) {
  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);

  return withTransaction(async () => {
    await execute(SQL.upsertAdd, [factionId, item.id, quantity]);
    const row = await queryOne(SQL.getRow, [factionId, item.id]);
    return { newQuantity: row?.quantity ?? 0 };
  });
}

export async function depositItem(discordId, faction, itemName, quantity, actor = {}) {
  if (!(quantity > 0)) throw new UserFacingError('La cantidad a depositar debe ser mayor que 0.');

  const scope = { type: 'faction', id: faction.id, factionId: faction.id, ownerPlayerId: faction.owner_player_id };
  const result = await resolvePermission({ discordId, isRolepriest: Boolean(actor.isRolepriest) }, scope, 'faction.storage_deposit');
  if (!result.allowed) {
    throw new UserFacingError(`No puedes depositar en el almacén de **${faction.display_name}** — ${result.reason}.`);
  }

  if (!(await hasEnough(discordId, itemName, quantity))) {
    throw new UserFacingError(`No tienes **${quantity}** de **${itemName}** en tu inventario.`);
  }

  let outcome;
  await withTransaction(async () => {
    await removeItem(discordId, itemName, quantity);
    outcome = await addToStorage(faction.id, itemName, quantity);
  });
  return outcome;
}

export async function withdrawItem(discordId, faction, itemName, quantity, actor = {}) {
  if (!(quantity > 0)) throw new UserFacingError('La cantidad a retirar debe ser mayor que 0.');

  const scope = { type: 'faction', id: faction.id, factionId: faction.id, ownerPlayerId: faction.owner_player_id };
  const result = await resolvePermission({ discordId, isRolepriest: Boolean(actor.isRolepriest) }, scope, 'faction.storage_withdraw');
  if (!result.allowed) {
    throw new UserFacingError(`No puedes retirar del almacén de **${faction.display_name}** — ${result.reason}.`);
  }

  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);
  const row = await queryOne(SQL.getRow, [faction.id, item.id]);
  const available = row?.quantity ?? 0;
  if (available < quantity) {
    throw new UserFacingError(`El almacén de **${faction.display_name}** solo tiene **${available}** de **${item.display_name}**.`);
  }

  let remaining;
  await withTransaction(async () => {
    const subtractResult = await execute(SQL.subtract, [quantity, faction.id, item.id, quantity]);
    if (subtractResult.changes === 0) {
      throw new UserFacingError(`El almacén de **${faction.display_name}** ya no tiene suficiente de **${item.display_name}**.`);
    }
    await addItem(discordId, item.name, quantity);
    remaining = (await queryOne(SQL.getRow, [faction.id, item.id]))?.quantity ?? 0;
  });

  return { withdrawn: quantity, remaining };
}

export async function spendFromStorage(factionId, itemId, quantity) {
  const row = await queryOne(SQL.getRow, [factionId, itemId]);
  const available = row?.quantity ?? 0;
  if (available < quantity) {
    throw new UserFacingError(`El almacén de la facción no tiene suficiente de ese ítem (tiene ${available}, hacen falta ${quantity}).`);
  }
  const result = await execute(SQL.subtract, [quantity, factionId, itemId, quantity]);
  if (result.changes === 0) {
    throw new UserFacingError('El almacén de la facción ya no tiene suficiente de ese ítem.');
  }
}
