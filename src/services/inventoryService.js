









































import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { getAvailableLaburo, earnLaburo, spendLaburo } from './laburoService.js';




const ITEM_TYPE_PRIORITY = { dinero: 1, laburo: 2, consumible: 3, recurso: 4, herramienta: 5 };
function itemTypeOrder(itemType) {
  return ITEM_TYPE_PRIORITY[itemType] ?? 6;
}


const SQL = {


  getPlayerById: `SELECT id, username, inventory_capacity FROM ${T.players} WHERE discord_id = ?`,

  getTotalWeight: `
    SELECT COALESCE(SUM(inv.quantity * it.weight), 0) AS total
    FROM ${T.inventory} inv
    JOIN ${T.items} it ON inv.item_id = it.id
    WHERE inv.player_id = ?
  `,

  getItemByName: `SELECT * FROM ${T.items} WHERE name = ?`,

  getFullInventory: `
    SELECT
      inv.quantity,
      inv.durability,
      inv.slot_position,
      it.name,
      it.display_name,
      it.item_type,
      it.emoji,
      it.description,
      it.weapon_max_durability,
      it.is_consumable
    FROM ${T.inventory} inv
    JOIN ${T.items} it ON inv.item_id = it.id
    WHERE inv.player_id = ?
      AND inv.quantity   > 0
    ORDER BY
      inv.slot_position IS NULL, inv.slot_position ASC,
      CASE it.item_type
        WHEN 'dinero'      THEN 1
        WHEN 'laburo'      THEN 2
        WHEN 'consumible'  THEN 3
        WHEN 'recurso'     THEN 4
        WHEN 'herramienta' THEN 5
        ELSE                    6
      END ASC,
      it.display_name ASC
  `,

  getQuantity: `
    SELECT quantity FROM ${T.inventory}
    WHERE player_id = ? AND item_id = ?
  `,

  upsertAdd: `
    INSERT INTO ${T.inventory} (player_id, item_id, quantity)
    SELECT ?, ?, ? FROM DUAL
    WHERE (
      SELECT COALESCE(SUM(inv.quantity * it.weight), 0)
      FROM ${T.inventory} inv JOIN ${T.items} it ON it.id = inv.item_id
      WHERE inv.player_id = ?
    ) + ? <= (SELECT inventory_capacity FROM ${T.players} WHERE id = ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
  `,

  subtract: `
    UPDATE ${T.inventory}
    SET quantity = quantity - ?
    WHERE player_id = ? AND item_id = ? AND quantity >= ?
  `,

  upsertSet: `
    INSERT INTO ${T.inventory} (player_id, item_id, quantity)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)
  `,

  deleteIfZero: `
    DELETE FROM ${T.inventory}
    WHERE player_id = ? AND item_id = ? AND quantity <= 0
  `,

  setInventoryCapacity: `UPDATE ${T.players} SET inventory_capacity = ? WHERE discord_id = ?`,

  setSlotPosition: `
    UPDATE ${T.inventory} SET slot_position = ? WHERE player_id = ? AND item_id = ?
  `,
};




async function resolvePlayer(discordId) {
  const row = await queryOne(SQL.getPlayerById, [discordId]);
  if (!row) {
    throw new Error(`Jugador con Discord ID "${discordId}" no encontrado en la BD.`);
  }
  return row;
}


async function resolveItem(itemName) {
  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) {
    throw new Error(
      `El ítem "${itemName}" no existe en el catálogo. ` +
      `Un miembro del Staff puede crearlo con /item create.`
    );
  }
  return item;
}




async function _addItemTx(discordId, itemName, quantity) {
  return withTransaction(async () => {
    if (quantity <= 0) throw new Error('La cantidad a añadir debe ser un número positivo.');

    const player = await resolvePlayer(discordId);
    const item   = await resolveItem(itemName);








    const { total: currentWeight } = await queryOne(SQL.getTotalWeight, [player.id]);
    const addedWeight = item.weight * quantity;
    const noRoom = () => new Error(
      `**${player.username}** no tiene espacio: llevas **${currentWeight}/${player.inventory_capacity}** de capacidad, ` +
      `y **${quantity}× ${item.display_name}** pesaría **${addedWeight}** más.`
    );
    if (currentWeight + addedWeight > player.inventory_capacity) throw noRoom();

    const added = await execute(SQL.upsertAdd, [player.id, item.id, quantity, player.id, addedWeight, player.id]);
    if (added.changes === 0) throw noRoom();

    const row = await queryOne(SQL.getQuantity, [player.id, item.id]);
    return { newQuantity: row.quantity, item };
  });
}


async function _removeItemTx(discordId, itemName, quantity) {
  return withTransaction(async () => {
    if (quantity <= 0) throw new Error('La cantidad a retirar debe ser un número positivo.');

    const player  = await resolvePlayer(discordId);
    const item    = await resolveItem(itemName);
    const current = await queryOne(SQL.getQuantity, [player.id, item.id]);


    if (!current || current.quantity < quantity) {
      throw new Error(
        `Saldo insuficiente: se requieren **${quantity}** de **${item.display_name}** ` +
        `pero ${player.username} solo tiene **${current?.quantity ?? 0}**.`
      );
    }





    const result = await execute(SQL.subtract, [quantity, player.id, item.id, quantity]);
    if (result.changes === 0) {
      throw new Error(`Error interno al descontar "${item.display_name}". Operación cancelada.`);
    }


    await execute(SQL.deleteIfZero, [player.id, item.id]);

    const remaining   = await queryOne(SQL.getQuantity, [player.id, item.id]);
    const newQuantity = remaining?.quantity ?? 0;

    return { newQuantity, item };
  });
}


async function _setItemQuantityTx(discordId, itemName, quantity) {
  return withTransaction(async () => {
    if (quantity < 0) throw new Error('La cantidad no puede ser negativa.');

    const player = await resolvePlayer(discordId);
    const item   = await resolveItem(itemName);

    await execute(SQL.upsertSet, [player.id, item.id, quantity]);

    await execute(SQL.deleteIfZero, [player.id, item.id]);

    return { newQuantity: quantity, item };
  });
}




export async function getInventory(discordId) {
  const player = await resolvePlayer(discordId);
  const rows = (await query(SQL.getFullInventory, [player.id])).filter(row => row.name !== 'laburo');

  const laburoTotal = await getAvailableLaburo(discordId);
  if (laburoTotal > 0) {






    const laburoItem = (await queryOne(SQL.getItemByName, ['laburo']))
      ?? { name: 'laburo', display_name: 'Laburo', item_type: 'laburo', emoji: '💪', description: '' };
    rows.push({
      quantity:     laburoTotal,
      name:         laburoItem.name,
      display_name: laburoItem.display_name,
      item_type:    laburoItem.item_type,
      emoji:        laburoItem.emoji,
      description:  laburoItem.description,
      is_consumable: 0,
    });
  }







  rows.sort((a, b) => {
    const aPos = a.slot_position, bPos = b.slot_position;
    if (aPos != null && bPos != null) return aPos - bPos;
    if (aPos != null) return -1;
    if (bPos != null) return 1;
    const diff = itemTypeOrder(a.item_type) - itemTypeOrder(b.item_type);
    return diff !== 0 ? diff : a.display_name.localeCompare(b.display_name);
  });

  return rows;
}


export async function addItem(discordId, itemName, quantity) {
  const result = await _addItemTx(discordId, itemName, quantity);
  logger.debug(
    `[Inventory] +${quantity} "${result.item.display_name}" → ` +
    `player ${discordId} (total: ${result.newQuantity})`
  );
  return result;
}


export async function removeItem(discordId, itemName, quantity) {
  const result = await _removeItemTx(discordId, itemName, quantity);
  logger.debug(
    `[Inventory] -${quantity} "${result.item.display_name}" → ` +
    `player ${discordId} (restante: ${result.newQuantity})`
  );
  return result;
}


export async function setItemQuantity(discordId, itemName, quantity) {
  const result = await _setItemQuantityTx(discordId, itemName, quantity);
  logger.debug(
    `[Inventory] "${result.item.display_name}" fijado a ${quantity} → ` +
    `player ${discordId}`
  );
  return result;
}


export async function hasEnough(discordId, itemName, quantity) {
  try {


    if (itemName.toLowerCase().trim() === 'laburo') {
      return (await getAvailableLaburo(discordId)) >= quantity;
    }

    const player = await resolvePlayer(discordId);
    const item   = await resolveItem(itemName);
    const row    = await queryOne(SQL.getQuantity, [player.id, item.id]);
    return (row?.quantity ?? 0) >= quantity;
  } catch {
    return false;
  }
}


export async function getItemQuantity(discordId, itemName) {
  try {
    if (itemName.toLowerCase().trim() === 'laburo') {
      return await getAvailableLaburo(discordId);
    }
    const player = await resolvePlayer(discordId);
    const item   = await resolveItem(itemName);
    const row    = await queryOne(SQL.getQuantity, [player.id, item.id]);
    return row?.quantity ?? 0;
  } catch {
    return 0;
  }
}


export async function getInventoryWeight(discordId) {
  const player = await resolvePlayer(discordId);
  const { total } = await queryOne(SQL.getTotalWeight, [player.id]);
  return { weight: total, capacity: player.inventory_capacity };
}


export async function setInventoryCapacity(discordId, capacity) {
  if (!(capacity > 0)) throw new Error('La capacidad debe ser un número mayor que 0.');
  await resolvePlayer(discordId);
  await execute(SQL.setInventoryCapacity, [capacity, discordId]);
  return capacity;
}


async function _setInventorySlotOrderTx(discordId, itemNames) {
  return withTransaction(async () => {
    const player = await resolvePlayer(discordId);
    for (const [index, itemName] of itemNames.entries()) {
      const item = await resolveItem(itemName);
      await execute(SQL.setSlotPosition, [index, player.id, item.id]);
    }
  });
}


export async function setInventorySlotOrder(discordId, itemNames) {
  await _setInventorySlotOrderTx(discordId, itemNames);
  logger.debug(`[Inventory] Orden manual fijado para ${discordId}: ${itemNames.join(', ')}`);
}















const LABURO_PSEUDO_ITEM = { id: null, name: 'laburo', display_name: 'Laburo', emoji: '💪', item_type: 'laburo' };


export async function grantItem(discordId, itemName, quantity) {
  if (itemName.toLowerCase().trim() === 'laburo') {
    await earnLaburo(discordId, quantity);
    return { item: LABURO_PSEUDO_ITEM, newQuantity: null };
  }
  return addItem(discordId, itemName, quantity);
}


export async function revokeItem(discordId, itemName, quantity) {
  if (itemName.toLowerCase().trim() === 'laburo') {
    await spendLaburo(discordId, quantity);
    return { item: LABURO_PSEUDO_ITEM, newQuantity: null };
  }
  return removeItem(discordId, itemName, quantity);
}
