import { withTransaction } from '../database/index.js';
import { takeRandomItem } from './npcInventoryService.js';
import { addItem } from './inventoryService.js';
import { resolveNpcCounterattack } from './npcCombatService.js';

export async function attemptTheft(client, discordId, npc) {
  const success = Math.random() * 100 < npc.theft_chance_percent;

  if (!success) {
    const npcCounterattack = await resolveNpcCounterattack(client, discordId, npc);
    return { success: false, item: null, npcCounterattack };
  }

  const item = await withTransaction(async () => {
    const taken = await takeRandomItem(npc.id);
    if (taken) await addItem(discordId, taken.name, 1);
    return taken;
  });

  return { success: true, item, npcCounterattack: null };
}
