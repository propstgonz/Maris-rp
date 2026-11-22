
























import { withTransaction } from '../database/index.js';
import { MAX_HP, MAX_HUNGER } from '../utils/permissions.js';
import { UserFacingError } from '../utils/errors.js';
import { getItemByName } from './itemService.js';
import { getPlayerByDiscordId, updateStats, applyEffect } from './playerService.js';
import { markDeceased } from './characterLifecycleService.js';
import { removeItem } from './inventoryService.js';
import { getEffectType } from './effectTypesService.js';

async function _consumeTx(client, discordId, item) {
  return withTransaction(async () => {
    const current = await getPlayerByDiscordId(discordId);
    if (!current) throw new UserFacingError('Jugador no encontrado al intentar consumir.');


    await removeItem(discordId, item.name, 1);


    const rawHp = Math.max(0, Math.min(MAX_HP,
      current.hp     + (item.consume_hp_delta     ?? 0)
    ));


    const newHp = current.is_immortal && rawHp <= 0 ? 1 : rawHp;
    const newHunger = Math.max(0, Math.min(MAX_HUNGER,
      current.hunger + (item.consume_hunger_delta ?? 0)
    ));

    let died = false;
    if (newHp <= 0) {
      await markDeceased(client, discordId, `los efectos de consumir ${item.display_name}`);
      died = true;
    } else if (newHp !== current.hp || newHunger !== current.hunger) {
      await updateStats(discordId, { hp: newHp, hunger: newHunger });
    }



    if (!died && item.consume_effect) {
      const meta = await getEffectType(item.consume_effect);
      await applyEffect(
        discordId,
        item.consume_effect,
        meta?.laburo_modifier  ?? 0,
        meta?.hp_delta_per_day ?? 0,
        item.consume_effect_duration_hours ?? null
      );
    }

    return {
      hpBefore:     current.hp,
      hungerBefore: current.hunger,
      hpAfter:      newHp,


      hungerAfter:  died ? current.hunger : newHunger,
      died,
      immortalitySaved: !died && current.is_immortal && rawHp <= 0,
    };
  });
}


export async function consumeItem(client, discordId, itemName) {
  const item = await getItemByName(itemName);
  if (!item) {
    throw new UserFacingError(`El ítem \`${itemName}\` no existe en el catálogo.`);
  }
  if (!item.is_consumable) {
    throw new UserFacingError(`**${item.display_name}** no es consumible.`);
  }

  const result = await _consumeTx(client, discordId, item);
  return { item, ...result };
}
