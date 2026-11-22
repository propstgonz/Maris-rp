



























import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { removeItem, addItem } from './inventoryService.js';
import { transferLaburo }      from './laburoService.js';

const SQL = {

  getPlayer: `
    SELECT id, discord_id, username, coord_x, coord_y, is_alive, avatar_filename, character_created_at
    FROM ${T.players} WHERE discord_id = ?
  `,

  getItemByName: `
    SELECT id, name, display_name, emoji, item_type
    FROM ${T.items} WHERE name = ?
  `,

  logTransaction: `
    INSERT INTO ${T.transactions}
      (from_player_id, to_player_id, item_id, quantity, coord_x, coord_y)
    VALUES (?, ?, ?, ?, ?, ?)
  `,

  listForPlayer: `
    SELECT
      t.id, t.quantity, t.coord_x, t.coord_y, t.created_at,
      fp.discord_id AS from_discord_id, fp.username AS from_username,
      tp.discord_id AS to_discord_id, tp.username AS to_username,
      i.name AS item_name, i.display_name AS item_display_name, i.emoji AS item_emoji
    FROM ${T.transactions} t
    JOIN ${T.players} fp ON fp.id = t.from_player_id
    JOIN ${T.players} tp ON tp.id = t.to_player_id
    LEFT JOIN ${T.items} i ON i.id = t.item_id
    WHERE fp.discord_id = ? OR tp.discord_id = ?
    ORDER BY t.id DESC LIMIT ? OFFSET ?
  `,
  countForPlayer: `
    SELECT COUNT(*) AS total FROM ${T.transactions} t
    JOIN ${T.players} fp ON fp.id = t.from_player_id
    JOIN ${T.players} tp ON tp.id = t.to_player_id
    WHERE fp.discord_id = ? OR tp.discord_id = ?
  `,

  listRecent: `
    SELECT
      t.id, t.quantity, t.coord_x, t.coord_y, t.created_at,
      fp.discord_id AS from_discord_id, fp.username AS from_username,
      tp.discord_id AS to_discord_id, tp.username AS to_username,
      i.name AS item_name, i.display_name AS item_display_name, i.emoji AS item_emoji
    FROM ${T.transactions} t
    JOIN ${T.players} fp ON fp.id = t.from_player_id
    JOIN ${T.players} tp ON tp.id = t.to_player_id
    LEFT JOIN ${T.items} i ON i.id = t.item_id
    ORDER BY t.id DESC LIMIT ? OFFSET ?
  `,
  countAll: `SELECT COUNT(*) AS total FROM ${T.transactions}`,
};





function _hydrateTransactionItem(row) {
  const { item_name, item_display_name, item_emoji, ...rest } = row;
  const item = item_name
    ? { name: item_name, display_name: item_display_name, emoji: item_emoji }
    : { name: 'laburo', display_name: 'Laburo', emoji: '💪' };
  return { ...rest, item };
}









const LABURO_PSEUDO_ITEM = { id: null, name: 'laburo', display_name: 'Laburo', emoji: '💪', item_type: 'laburo' };




async function _executeTrade(fromDiscordId, toDiscordId, itemName, quantity) {
  return withTransaction(async () => {
    const from = await queryOne(SQL.getPlayer, [fromDiscordId]);
    const to   = await queryOne(SQL.getPlayer, [toDiscordId]);
    const normalizedName = itemName.toLowerCase().trim();
    const isLaburo = normalizedName === 'laburo';





    const item = isLaburo ? LABURO_PSEUDO_ITEM : await queryOne(SQL.getItemByName, [normalizedName]);

    if (!item) {
      throw new Error(`El ítem "${itemName}" no existe en el catálogo.`);
    }


    if (from.coord_x !== to.coord_x || from.coord_y !== to.coord_y) {
      throw new Error(
        `Las posiciones ya no coinciden. El trade ha sido cancelado.\n` +
        `📍 Tu posición: **(${from.coord_x}, ${from.coord_y})**\n` +
        `📍 Posición de **${to.username}**: **(${to.coord_x}, ${to.coord_y})**`
      );
    }

    if (isLaburo) {
      await transferLaburo(fromDiscordId, toDiscordId, quantity);
    } else {
      await removeItem(fromDiscordId, itemName, quantity);
      await addItem(toDiscordId, itemName, quantity);
    }




    await execute(SQL.logTransaction, [
      from.id, to.id, item.id, quantity, from.coord_x, from.coord_y
    ]);

    return { from, to, item };
  });
}




export async function tradeBetweenPlayers(fromDiscordId, toDiscordId, itemName, quantity) {


  if (fromDiscordId === toDiscordId) {
    throw new Error('No puedes comerciar contigo mismo.');
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('La cantidad debe ser un número positivo.');
  }


  const from = await queryOne(SQL.getPlayer, [fromDiscordId]);
  if (!from) {
    throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  }
  if (!from.is_alive) {
    throw new Error('No puedes comerciar si tu personaje está muerto.');
  }


  const to = await queryOne(SQL.getPlayer, [toDiscordId]);
  if (!to) {
    throw new Error(
      'El jugador destino no está registrado en el juego. ' +
      'Pídele que use `/personaje crear` para empezar a rolear.'
    );
  }
  if (!to.character_created_at) {
    throw new Error(`**${to.username}** todavía no ha creado un personaje — no se puede comerciar con él.`);
  }
  if (!to.is_alive) {
    throw new Error(`No puedes comerciar con **${to.username}**: está muerto.`);
  }


  if (from.coord_x !== to.coord_x || from.coord_y !== to.coord_y) {
    throw new Error(
      `Para comerciar, ambos jugadores deben estar en la **misma casilla del mapa**.\n` +
      `📍 Tu posición: **(${from.coord_x}, ${from.coord_y})**\n` +
      `📍 Posición de **${to.username}**: **(${to.coord_x}, ${to.coord_y})**\n\n` +
      `Usa \`/move\` para desplazarte a la misma casilla.`
    );
  }



  const { item } = await _executeTrade(fromDiscordId, toDiscordId, itemName, quantity);

  logger.info(
    `[Trade] ${from.username} → ${to.username}: ` +
    `x${quantity} "${item.display_name}" @ (${from.coord_x},${from.coord_y})`
  );

  return {
    from,
    to,
    item,
    quantity,
    coord: { x: from.coord_x, y: from.coord_y },
  };
}


export async function listTransactionsForPlayer(discordId, { page = 1, pageSize = 30 } = {}) {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;
  const rows = (await query(SQL.listForPlayer, [discordId, discordId, pageSize, offset])).map(_hydrateTransactionItem);
  const { total } = await queryOne(SQL.countForPlayer, [discordId, discordId]);
  return { rows, total, page: safePage, pageSize };
}


export async function listRecentTransactions({ page = 1, pageSize = 50 } = {}) {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;
  const rows = (await query(SQL.listRecent, [pageSize, offset])).map(_hydrateTransactionItem);
  const { total } = await queryOne(SQL.countAll);
  return { rows, total, page: safePage, pageSize };
}
