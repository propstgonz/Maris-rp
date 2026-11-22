import { getItemById } from './itemService.js';
import { removeItem } from './inventoryService.js';
import { getPlayerByDiscordId } from './playerService.js';
import { tameNpc } from './npcService.js';
import { UserFacingError } from '../utils/errors.js';

export async function attemptTame(discordId, npc) {
  if (!npc.is_tameable) {
    throw new UserFacingError(`**${npc.type_display_name}** no se puede domesticar.`);
  }
  if (npc.is_aggressive) {
    throw new UserFacingError(`**${npc.type_display_name}** es hostil — no se puede domesticar, solo atacarlo, huir o rendirse.`);
  }
  if (npc.owner_player_id != null) {
    throw new UserFacingError(`**${npc.type_display_name}** ya tiene dueño — no puedes domesticar un animal de otro jugador.`);
  }
  if (!npc.tame_bait_item_id) {
    throw new UserFacingError(`**${npc.type_display_name}** no tiene un cebo de domesticación configurado — pide a un Rolepriest que lo añada.`);
  }

  const baitItem = await getItemById(npc.tame_bait_item_id);
  if (!baitItem) {
    throw new UserFacingError(`El cebo configurado para **${npc.type_display_name}** ya no existe en el catálogo — avisa a un Rolepriest.`);
  }

  await removeItem(discordId, baitItem.name, 1);

  if (!(Math.random() * 100 < npc.tame_chance_percent)) return { success: false, baitItem };

  const player = await getPlayerByDiscordId(discordId);
  return { success: await tameNpc(npc.id, player.id), baitItem };
}
