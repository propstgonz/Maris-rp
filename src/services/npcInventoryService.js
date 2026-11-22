import { query, execute } from '../database/index.js';
import { T } from '../database/tables.js';

const SQL = {
  getDropsForType: `SELECT item_id, quantity FROM ${T.npc_type_drops} WHERE npc_type_id = ?`,
  insertStock: `INSERT INTO ${T.npc_inventory} (npc_id, item_id, quantity) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,

  getInventory: `
    SELECT ni.item_id, ni.quantity, i.name, i.display_name, i.emoji, i.trade_value
    FROM ${T.npc_inventory} ni JOIN ${T.items} i ON i.id = ni.item_id
    WHERE ni.npc_id = ? AND ni.quantity > 0
    ORDER BY i.display_name ASC
  `,
  decrementStock: `
    UPDATE ${T.npc_inventory} SET quantity = quantity - ?
    WHERE npc_id = ? AND item_id = ? AND quantity >= ?
  `,
};

export async function seedNpcInventory(npcId, npcTypeId) {
  const drops = await query(SQL.getDropsForType, [npcTypeId]);
  for (const drop of drops) {
    await execute(SQL.insertStock, [npcId, drop.item_id, drop.quantity]);
  }
}

export async function getNpcInventory(npcId) {
  return query(SQL.getInventory, [npcId]);
}

export async function takeRandomItem(npcId) {
  const stock = await getNpcInventory(npcId);
  if (stock.length === 0) return null;

  const chosen = stock[Math.floor(Math.random() * stock.length)];
  const taken = await execute(SQL.decrementStock, [1, npcId, chosen.item_id, 1]);
  return taken.changes > 0 ? chosen : null;
}

export async function takeItem(npcId, itemId, quantity) {
  const taken = await execute(SQL.decrementStock, [quantity, npcId, itemId, quantity]);
  if (taken.changes === 0) {
    throw new Error('Ese NPC ya no tiene suficientes existencias de eso.');
  }
}

export async function giveItem(npcId, itemId, quantity) {
  await execute(SQL.insertStock, [npcId, itemId, quantity]);
}
