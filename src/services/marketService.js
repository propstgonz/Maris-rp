import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { isConstructionRuined } from '../utils/sql.js';
import { round2 } from '../utils/math.js';
import { resolveConstructionAtTile } from './mapService.js';
import { getConstructionTypeByName } from './constructionTypeService.js';
import { hasEnough, removeItem, addItem } from './inventoryService.js';
import { transferLaburo, getAvailableLaburo } from './laburoService.js';
import { findPlayerById } from './playerService.js';
import { resolvePermission } from './permissionService.js';

const SQL = {
  getItemByName: `SELECT id, name, display_name, emoji FROM ${T.items} WHERE name = ?`,

  upsertListing: `
    INSERT INTO ${T.construction_market_listings} (construction_id, item_id, price_laburo, stock_quantity)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      price_laburo = VALUES(price_laburo),
      stock_quantity = stock_quantity + VALUES(stock_quantity)
  `,

  getListing: `
    SELECT cml.id, cml.price_laburo, cml.stock_quantity, i.name, i.display_name, i.emoji
    FROM ${T.construction_market_listings} cml
    JOIN ${T.items} i ON cml.item_id = i.id
    WHERE cml.construction_id = ? AND cml.item_id = ?
  `,

  listListings: `
    SELECT cml.price_laburo, cml.stock_quantity, i.name, i.display_name, i.emoji
    FROM ${T.construction_market_listings} cml
    JOIN ${T.items} i ON cml.item_id = i.id
    WHERE cml.construction_id = ?
    ORDER BY i.display_name ASC
  `,

  decrementStock: `UPDATE ${T.construction_market_listings} SET stock_quantity = stock_quantity - ? WHERE construction_id = ? AND item_id = ? AND stock_quantity >= ?`,
};

function _requireUsableMarket(construction) {
  if (!construction.is_market) {
    throw new UserFacingError(`**${construction.name}** no es un puesto de comercio — Staff puede activarlo con \`/construction modify mercado:true\`.`);
  }
  if (isConstructionRuined(construction)) {
    throw new UserFacingError(`**${construction.name}** está en ruinas — no se puede comerciar aquí hasta que la reconstruyan.`);
  }
}

export async function stockMarketItem(discordId, x, y, constructionTypeName, itemName, priceLaburo, quantity, actor = {}, constructionId = null) {
  if (!Number.isFinite(priceLaburo) || priceLaburo <= 0) {
    throw new UserFacingError('El precio debe ser un número mayor que 0.');
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new UserFacingError('La cantidad a reponer debe ser un número mayor que 0.');
  }

  const constructionType = await _resolveTypeOrThrow(constructionTypeName);
  const construction = await resolveConstructionAtTile(x, y, constructionType, constructionId);
  if (!construction) {
    throw new UserFacingError(`No hay ninguna construcción de tipo **${constructionType.display_name}** en **(${x}, ${y})**.`);
  }
  _requireUsableMarket(construction);

  const scope = { type: 'construction', id: construction.id, factionId: construction.tile_faction_id, ownerPlayerId: construction.built_by_player_id };
  const permResult = await resolvePermission(
    { discordId, isRolepriest: Boolean(actor.isRolepriest) },
    scope, 'construction.market_manage', 'owner'
  );
  if (!permResult.allowed) {
    throw new UserFacingError(`No puedes reabastecer **${construction.name}** ni cambiar sus precios — ${permResult.reason}.`);
  }

  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);
  if (!(await hasEnough(discordId, item.name, quantity))) {
    throw new UserFacingError(`No tienes **${quantity}** de **${item.display_name}** en tu inventario para reponer el mercado.`);
  }

  await withTransaction(async () => {
    await removeItem(discordId, item.name, quantity);
    await execute(SQL.upsertListing, [construction.id, item.id, priceLaburo, quantity]);
  });

  const newStock = (await queryOne(SQL.getListing, [construction.id, item.id])).stock_quantity;
  logger.info(`[Market] ${discordId} repuso "${construction.name}" (${constructionType.name}) @ (${x},${y}): +${quantity} ${item.name} a ${priceLaburo}/u (stock: ${newStock})`);

  return { construction, item, priceLaburo, newStock };
}

export async function listMarketItems(x, y, constructionTypeName, constructionId = null) {
  const constructionType = await _resolveTypeOrThrow(constructionTypeName);
  const construction = await resolveConstructionAtTile(x, y, constructionType, constructionId);
  if (!construction) {
    throw new UserFacingError(`No hay ninguna construcción de tipo **${constructionType.display_name}** en **(${x}, ${y})**.`);
  }
  _requireUsableMarket(construction);

  return { construction, listings: await query(SQL.listListings, [construction.id]) };
}

export async function buyFromMarket(discordId, x, y, constructionTypeName, itemName, quantity, constructionId = null) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new UserFacingError('La cantidad a comprar debe ser un número mayor que 0.');
  }

  const constructionType = await _resolveTypeOrThrow(constructionTypeName);
  const construction = await resolveConstructionAtTile(x, y, constructionType, constructionId);
  if (!construction) {
    throw new UserFacingError(`No hay ninguna construcción de tipo **${constructionType.display_name}** en **(${x}, ${y})**.`);
  }
  _requireUsableMarket(construction);

  if (!construction.built_by_player_id) {
    throw new UserFacingError(`**${construction.name}** no tiene un dueño registrado que cobre la venta — avisa a Staff.`);
  }
  const owner = await findPlayerById(construction.built_by_player_id);
  if (!owner) {
    throw new UserFacingError(`El dueño de **${construction.name}** ya no existe — avisa a Staff.`);
  }
  if (owner.discord_id === discordId) {
    throw new UserFacingError('No puedes comprarte a ti mismo en tu propio mercado — usa tu inventario directamente.');
  }

  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`No existe ningún ítem "${itemName}" en el catálogo.`);

  const listing = await queryOne(SQL.getListing, [construction.id, item.id]);
  if (!listing || listing.stock_quantity <= 0) {
    throw new UserFacingError(`**${construction.name}** no tiene **${item.display_name}** en venta ahora mismo.`);
  }
  if (listing.stock_quantity < quantity) {
    throw new UserFacingError(`**${construction.name}** solo tiene **${listing.stock_quantity}** de **${item.display_name}** en stock — pide menos, o vuelve cuando repongan.`);
  }

  const totalCost = round2(listing.price_laburo * quantity);
  const available = await getAvailableLaburo(discordId);
  if (available < totalCost) {
    throw new UserFacingError(`Necesitas **${totalCost}** de Laburo para comprar **${quantity}** de **${item.display_name}** (a ${listing.price_laburo}/u), tienes **${available.toFixed(2)}**.`);
  }

  await withTransaction(async () => {
    const decrementResult = await execute(SQL.decrementStock, [quantity, construction.id, item.id, quantity]);
    if (decrementResult.changes === 0) {
      throw new UserFacingError(`**${construction.name}** ya no tiene suficiente **${item.display_name}** en stock — pide menos, o vuelve cuando repongan.`);
    }
    await transferLaburo(discordId, owner.discord_id, totalCost);
    await addItem(discordId, item.name, quantity);
  });

  const remainingStock = (await queryOne(SQL.getListing, [construction.id, item.id]))?.stock_quantity ?? 0;
  logger.info(`[Market] ${discordId} compró ${quantity} ${item.name} de "${construction.name}" (${constructionType.name}) @ (${x},${y}) por ${totalCost} Laburo → ${owner.discord_id}`);

  return { construction, item, quantity, totalCost, remainingStock };
}

async function _resolveTypeOrThrow(constructionTypeName) {
  const constructionType = await getConstructionTypeByName(constructionTypeName.toLowerCase().trim());
  if (!constructionType) {
    throw new UserFacingError(`No existe ningún tipo de construcción llamado \`${constructionTypeName}\`. Usa \`/build list\`.`);
  }
  return constructionType;
}
