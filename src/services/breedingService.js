import { createOwnedNpc, markBred } from './npcService.js';
import { BREEDING_COOLDOWN_HOURS } from '../utils/permissions.js';
import { UserFacingError } from '../utils/errors.js';

export async function attemptBreed(player, npcA, npcB) {
  if (npcA.id === npcB.id) throw new UserFacingError('Hacen falta dos animales distintos.');
  if (npcA.owner_player_id !== player.id || npcB.owner_player_id !== player.id) {
    throw new UserFacingError('Los dos animales tienen que ser tuyos.');
  }
  if (npcA.npc_type_id !== npcB.npc_type_id) {
    throw new UserFacingError('Solo se pueden criar dos animales del MISMO tipo.');
  }
  if (npcA.coord_x !== npcB.coord_x || npcA.coord_y !== npcB.coord_y) {
    throw new UserFacingError('Los dos animales tienen que estar en la misma casilla.');
  }
  if (npcA.coord_x !== player.coord_x || npcA.coord_y !== player.coord_y) {
    throw new UserFacingError(
      `Tienes que estar con ellos para criarlos. ` +
      `Tu posición: (${player.coord_x}, ${player.coord_y}) · Ellos están en (${npcA.coord_x}, ${npcA.coord_y}).`
    );
  }

  const now = Date.now();
  for (const parent of [npcA, npcB]) {
    if (!parent.last_bred_at) continue;
    const readyAt = new Date(parent.last_bred_at).getTime() + BREEDING_COOLDOWN_HOURS * 3_600_000;
    if (now < readyAt) {
      const hoursLeft = Math.ceil((readyAt - now) / 3_600_000);
      throw new UserFacingError(`**${parent.type_display_name}** #${parent.id} todavía no puede volver a criar — le quedan ${hoursLeft}h.`);
    }
  }

  const success = Math.random() * 100 < npcA.breed_chance_percent;
  await markBred(npcA.id, npcB.id);
  if (!success) return { success: false, offspring: null };

  const offspring = await createOwnedNpc(npcA.tile_id, npcA.npc_type_id, player.id);
  return { success: true, offspring };
}
