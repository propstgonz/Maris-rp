

















import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { addItem, removeItem } from './inventoryService.js';

const SQL = {
  getTile: `SELECT id, name FROM ${T.map_tiles} WHERE coord_x = ? AND coord_y = ?`,

  getPlayer: `SELECT id, username FROM ${T.players} WHERE discord_id = ?`,

  getItemByName: `SELECT * FROM ${T.items} WHERE name = ?`,

  getItemsAtTile: `
    SELECT ti.quantity, i.name, i.display_name, i.item_type, i.emoji,
           p.username AS dropped_by_username
    FROM ${T.tile_items} ti
    JOIN ${T.items} i ON ti.item_id = i.id
    LEFT JOIN ${T.players} p ON ti.dropped_by_player_id = p.id
    WHERE ti.tile_id = ? AND ti.quantity > 0
    ORDER BY i.display_name ASC
  `,

  getQuantityAtTile: `
    SELECT quantity FROM ${T.tile_items} WHERE tile_id = ? AND item_id = ?
  `,

  upsertAdd: `
    INSERT INTO ${T.tile_items} (tile_id, item_id, quantity, dropped_by_player_id)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity), dropped_by_player_id = VALUES(dropped_by_player_id)
  `,

  subtract: `
    UPDATE ${T.tile_items} SET quantity = quantity - ?
    WHERE tile_id = ? AND item_id = ? AND quantity >= ?
  `,

  deleteIfZero: `DELETE FROM ${T.tile_items} WHERE tile_id = ? AND item_id = ? AND quantity <= 0`,

  deleteOne: `DELETE FROM ${T.tile_items} WHERE tile_id = ? AND item_id = ?`,

  deleteAllForTile: `DELETE FROM ${T.tile_items} WHERE tile_id = ?`,
};

async function resolveTile(x, y) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) {
    throw new Error(`No existe ninguna casilla en **(${x}, ${y})**. Créala primero con \`/map create\`.`);
  }
  return tile;
}

async function resolveItem(itemName) {
  const normalized = itemName.toLowerCase().trim();














  if (normalized === 'laburo') {
    throw new Error('El Laburo no se puede tirar ni recoger del suelo — usa `/laburo trade` para dárselo a otro jugador.');
  }

  const item = await queryOne(SQL.getItemByName, [normalized]);
  if (!item) {
    throw new Error(`El ítem "${itemName}" no existe en el catálogo.`);
  }
  return item;
}


export async function getItemsAtTile(x, y) {
  const tile = await queryOne(SQL.getTile, [x, y]);
  if (!tile) return [];
  return query(SQL.getItemsAtTile, [tile.id]);
}


export async function dropItem(discordId, x, y, itemName, quantity) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('La cantidad a tirar debe ser un número positivo.');
  }

  const tile   = await resolveTile(x, y);
  const player = await queryOne(SQL.getPlayer, [discordId]);
  if (!player) throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  const item = await resolveItem(itemName);

  await withTransaction(async () => {
    await removeItem(discordId, itemName, quantity);
    await execute(SQL.upsertAdd, [tile.id, item.id, quantity, player.id]);
  });

  const row = await queryOne(SQL.getQuantityAtTile, [tile.id, item.id]);
  logger.info(`[TileItems] ${player.username} tiró x${quantity} "${item.display_name}" en (${x},${y})`);

  return { item, tileQuantity: row?.quantity ?? 0 };
}


export async function spawnLoot(x, y, itemName, quantity) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('La cantidad de botín debe ser un número positivo.');
  }

  const tile = await resolveTile(x, y);
  const item = await resolveItem(itemName);

  await execute(SQL.upsertAdd, [tile.id, item.id, quantity, null]);

  const row = await queryOne(SQL.getQuantityAtTile, [tile.id, item.id]);
  logger.info(`[TileItems] Botín: x${quantity} "${item.display_name}" en (${x},${y})`);

  return { item, tileQuantity: row?.quantity ?? 0 };
}


export async function grabItem(discordId, x, y, itemName, quantity) {
  const tile = await resolveTile(x, y);
  const item = await resolveItem(itemName);

  const available = (await queryOne(SQL.getQuantityAtTile, [tile.id, item.id]))?.quantity ?? 0;
  if (available <= 0) {
    throw new Error(`No hay **${item.display_name}** tirado en esta casilla.`);
  }

  const grabQty = quantity ?? available;
  if (!Number.isFinite(grabQty) || grabQty <= 0) {
    throw new Error('La cantidad a recoger debe ser un número positivo.');
  }
  if (grabQty > available) {
    throw new Error(`Solo hay **${available}** de **${item.display_name}** en esta casilla.`);
  }

  await withTransaction(async () => {
    const result = await execute(SQL.subtract, [grabQty, tile.id, item.id, grabQty]);
    if (result.changes === 0) {
      throw new Error('No se pudo recoger el ítem (cambió mientras tanto). Inténtalo de nuevo.');
    }
    await execute(SQL.deleteIfZero, [tile.id, item.id]);
    await addItem(discordId, itemName, grabQty);
  });

  logger.info(`[TileItems] ${discordId} recogió x${grabQty} "${item.display_name}" de (${x},${y})`);
  return { item, grabbed: grabQty };
}


export async function clearTileItem(x, y, itemName) {
  const tile = await resolveTile(x, y);
  const item = await resolveItem(itemName);
  const result = await execute(SQL.deleteOne, [tile.id, item.id]);
  logger.info(`[TileItems] Limpiado "${item.display_name}" de (${x},${y})`);
  return result.changes;
}


export async function clearAllTileItems(x, y) {
  const tile = await resolveTile(x, y);
  const result = await execute(SQL.deleteAllForTile, [tile.id]);
  logger.info(`[TileItems] Casilla (${x},${y}) vaciada de ítems (${result.changes} fila/s)`);
  return result.changes;
}
