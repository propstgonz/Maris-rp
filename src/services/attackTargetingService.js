import { getPlayersInRadius } from './playerService.js';
import { getConstructionsInRadius } from './mapService.js';
import { getNpcsInRadius } from './npcService.js';
import { weaponMaxRange, weaponFacesReaching } from './combatService.js';
import { UserFacingError } from '../utils/errors.js';
import { componentEmoji } from '../utils/emoji.js';

export const KIND = { player: 'p', npc: 'n', construction: 'c' };

export function describeReach(weapon, distance) {
  const faces = weaponFacesReaching(weapon, distance);
  const where = distance === 0 ? 'en tu casilla' : `a ${distance} ${distance === 1 ? 'casilla' : 'casillas'}`;
  return `${where} · ${faces}/6 caras llegan`;
}

export async function collectTargets(player, weapon) {
  const range = weapon ? weaponMaxRange(weapon) : 0;
  const targets = [];

  for (const other of await getPlayersInRadius(player.coord_x, player.coord_y, range, player.discord_id)) {
    targets.push({
      kind: KIND.player,
      id: other.discord_id,
      label: other.character_name ?? other.username,
      detail: `${other.hp} HP · ${weapon ? describeReach(weapon, other.distance) : 'en tu casilla'}`,
      emoji: '🧑',
      distance: other.distance,
      x: other.coord_x,
      y: other.coord_y,
    });
  }

  if (weapon) {
    for (const npc of await getNpcsInRadius(player.coord_x, player.coord_y, range)) {
      targets.push({
        kind: KIND.npc,
        id: String(npc.id),
        label: npc.type_display_name,
        detail: `${npc.current_hp} HP · ${describeReach(weapon, npc.distance)}`,
        emoji: componentEmoji(npc.type_emoji, '👹'),
        distance: npc.distance,
        x: npc.coord_x,
        y: npc.coord_y,
      });
    }
  }

  if (weapon?.weapon_structure_damage) {
    for (const c of await getConstructionsInRadius(player.coord_x, player.coord_y, range)) {
      targets.push({
        kind: KIND.construction,
        id: String(c.id),
        label: c.ct_display_name ?? c.name,
        detail: `(${c.coord_x}, ${c.coord_y}) · ${describeReach(weapon, c.distance)}`,
        emoji: componentEmoji(c.ct_emoji, '🏗️'),
        distance: c.distance,
        x: c.coord_x,
        y: c.coord_y,
      });
    }
  }

  return targets.sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label));
}

export async function collectTargetsAtTile(player, weapon, tile) {
  const range = weapon ? weaponMaxRange(weapon) : 0;
  const distance = Math.max(Math.abs(tile.x - player.coord_x), Math.abs(tile.y - player.coord_y));
  if (distance > range) {
    throw new UserFacingError(
      `La casilla **(${tile.x}, ${tile.y})** está a **${distance}** casillas y ` +
      `**${weapon ? weapon.display_name : 'los puños'}** solo llega a **${range}**.`
    );
  }

  return (await collectTargets(player, weapon))
    .filter(t => t.x === tile.x && t.y === tile.y);
}
