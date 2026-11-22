import { withTransaction } from '../database/index.js';
import { getInventory, removeItem } from './inventoryService.js';
import { SURRENDER_LOOT_MIN_ITEMS, SURRENDER_LOOT_MAX_ITEMS } from '../utils/permissions.js';
import logger from '../utils/logger.js';

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function pickSurrenderLoot(discordId, deliver) {
  const inventory = await getInventory(discordId);
  const candidates = inventory.filter(row => row.item_type !== 'vehiculo' && row.name !== 'laburo' && row.quantity > 0);
  if (candidates.length === 0) return [];

  const count = Math.min(
    candidates.length,
    SURRENDER_LOOT_MIN_ITEMS + Math.floor(Math.random() * (SURRENDER_LOOT_MAX_ITEMS - SURRENDER_LOOT_MIN_ITEMS + 1))
  );

  const taken = [];
  for (const row of shuffle(candidates).slice(0, count)) {
    try {
      await withTransaction(async () => {
        await removeItem(discordId, row.name, 1);
        await deliver({ name: row.name, quantity: 1 });
      });
    } catch (err) {
      logger.warn(`[Surrender] "${row.name}" de ${discordId} no se pudo entregar y se queda con él: ${err.message}`);
      continue;
    }
    taken.push({ name: row.name, display_name: row.display_name, emoji: row.emoji, quantity: 1 });
  }
  return taken;
}
