import { withTransaction } from '../database/index.js';
import { removeItem, addItem } from './inventoryService.js';
import { takeItem } from './npcInventoryService.js';

export function evaluateNpcTrade(npc, giveItem, giveQty, getItem, getQty) {
  const offeredValue = giveItem.trade_value * giveQty;
  const requestedValue = getItem.trade_value * getQty;
  const requiredValue = requestedValue * (npc.trade_margin_percent / 100);
  return { fair: offeredValue >= requiredValue, offeredValue, requestedValue, requiredValue };
}

export async function executeNpcTrade(discordId, npc, giveItem, giveQty, getItem, getQty) {
  const verdict = evaluateNpcTrade(npc, giveItem, giveQty, getItem, getQty);
  if (!verdict.fair) {
    throw new Error(
      `No le parece un trato justo: lo que ofreces vale ${verdict.offeredValue} y pide al menos ${verdict.requiredValue} a cambio de eso.`
    );
  }

  await withTransaction(async () => {
    await removeItem(discordId, giveItem.name, giveQty);
    await takeItem(npc.id, getItem.id, getQty);
    await addItem(discordId, getItem.name, getQty);
  });

  return verdict;
}
