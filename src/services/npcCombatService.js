import logger from '../utils/logger.js';
import { MAX_HP } from '../utils/permissions.js';
import { rollDie } from '../utils/dice.js';
import { updateStats } from './playerService.js';
import { markDeceased } from './characterLifecycleService.js';
import { getItemById } from './itemService.js';
import { getNpcById, getNpcsInRadius, getSoldierNpcsAtTile, damageNpc, healNpc, resolveNpcDeath } from './npcService.js';
import { chebyshevGridDistance } from '../utils/geometry.js';
import {
  getCombatant, getPlayerWeapon, applyOutcomeModifier, selectNpcCombatWeapon,
  degradeWeaponDurability, _claimAttackCost, _clampIfImmortal,
  _hasCombatProtection, _tilePreventsCombat, rollRangeCheckForNpcCombat,
} from './combatService.js';

async function resolveNpcWeapons(npc) {
  const [primary, secondary] = await Promise.all([
    npc.weapon_item_id ? getItemById(npc.weapon_item_id) : null,
    npc.secondary_weapon_item_id ? getItemById(npc.secondary_weapon_item_id) : null,
  ]);
  return { primary, secondary };
}

function _applyMountDamageBonus(weapon, npc) {
  if (!weapon || !npc.mount_damage_bonus) return weapon;
  return { ...weapon, weapon_damage: (weapon.weapon_damage ?? 0) + npc.mount_damage_bonus };
}

export function pickHealTarget(self, allies, thresholdPercent) {
  const candidates = [self, ...allies].filter(c => c.current_hp > 0 && c.type_max_hp > 0);
  const eligible = candidates.filter(c => (c.current_hp / c.type_max_hp) * 100 <= thresholdPercent);
  if (eligible.length === 0) return null;
  return eligible.reduce((lowest, c) =>
    (c.current_hp / c.type_max_hp) < (lowest.current_hp / lowest.type_max_hp) ? c : lowest
  );
}

export async function resolveNpcHealAttempt(npc) {
  if (!npc.heal_item_id) return null;

  const healItem = await getItemById(npc.heal_item_id);
  if (!healItem?.is_consumable || !(healItem.consume_hp_delta > 0)) return null;

  const allies = npc.spawned_from_group_type_id
    ? (await getNpcsInRadius(npc.coord_x, npc.coord_y, healItem.heal_range))
        .filter(n => n.id !== npc.id && n.current_hp > 0 && n.spawned_from_group_type_id === npc.spawned_from_group_type_id)
    : [];

  const target = pickHealTarget(
    { id: npc.id, current_hp: npc.current_hp, type_max_hp: npc.type_max_hp },
    allies.map(a => ({ id: a.id, current_hp: a.current_hp, type_max_hp: a.type_max_hp })),
    npc.heal_threshold_percent
  );
  if (!target) return null;

  const isSelf = target.id === npc.id;
  const targetRow = isSelf ? npc : allies.find(a => a.id === target.id);
  const { healthBefore, healthAfter } = await healNpc(target.id, healItem.consume_hp_delta);

  logger.info(
    `[NpcCombat] "${npc.type_display_name}" #${npc.id} usó "${healItem.display_name}" en ` +
    `${isSelf ? 'sí mismo' : `"${targetRow.type_display_name}" #${target.id}`} (${healthBefore}→${healthAfter} HP)`
  );

  return {
    isSelf, healthBefore, healthAfter,
    item: { name: healItem.name, display_name: healItem.display_name, emoji: healItem.emoji },
    target: { id: target.id, type_display_name: targetRow.type_display_name, type_emoji: targetRow.type_emoji },
  };
}

export async function resolveAttackOnNpc(client, attackerDiscordId, npcId, weaponItemName) {
  const attacker = await getCombatant(attackerDiscordId);
  if (!attacker) throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!attacker.is_alive) throw new Error('No puedes atacar si tu personaje está muerto.');

  const npc = await getNpcById(npcId);
  if (!npc) throw new Error(`No existe ningún NPC con ID ${npcId}.`);

  const distance = chebyshevGridDistance(attacker, npc);

  const weapon = await getPlayerWeapon(attackerDiscordId, weaponItemName);
  if (!weapon || weapon.quantity < 1) {
    throw new Error(`No tienes **${weaponItemName}** en tu inventario (o no es un arma).`);
  }

  if (await _hasCombatProtection(attacker)
      || await _tilePreventsCombat(attacker.coord_x, attacker.coord_y)
      || await _tilePreventsCombat(npc.coord_x, npc.coord_y)) {
    throw new Error('No puedes atacar — tu casilla o la del objetivo tienen un estado activo que impide el combate (zona segura).');
  }

  const ammoConsumed = await _claimAttackCost(attacker, attackerDiscordId, weapon);

  const { rangeRoll, inRange, meleeOnly } = rollRangeCheckForNpcCombat(weapon, distance);

  const result = {
    attacker, npc, weapon, distance,
    rangeRoll, inRange, meleeOnly,
    outcomeRoll: null, hit: false, damage: 0,
    npcHpAfter: npc.current_hp, npcDied: false, drops: [],
    weaponBroke: false, weaponDurabilityAfter: weapon.durability ?? null, ammoConsumed,
    npcCounterattack: null,
  };

  if (!inRange) {
    logger.info(
      `[NpcCombat] ${attacker.username} disparó a "${npc.type_display_name}" #${npcId} con "${weapon.name}" ` +
      `(distancia ${distance}, tirada de alcance ${rangeRoll ?? 'n/a'}) → FUERA DE ALCANCE`
    );
    return result;
  }

  const outcomeRoll = rollDie(6);
  result.outcomeRoll = outcomeRoll;

  if (outcomeRoll === 1) {
    const { broke, durabilityAfter } = await degradeWeaponDurability(attackerDiscordId, attacker.id, weapon);
    result.weaponBroke = broke;
    result.weaponDurabilityAfter = durabilityAfter;
    logger.info(`[NpcCombat] ${attacker.username} atacó a "${npc.type_display_name}" #${npcId} con "${weapon.name}" (resultado 1) → FALLA Y DAÑA EL ARMA`);
  } else if (outcomeRoll === 2) {
    logger.info(`[NpcCombat] ${attacker.username} atacó a "${npc.type_display_name}" #${npcId} con "${weapon.name}" (resultado 2) → FALLA`);
  } else {
    result.hit = true;
    const damage = applyOutcomeModifier(weapon.weapon_damage ?? 0, outcomeRoll);
    const { healthAfter, died } = await damageNpc(npcId, damage);
    result.damage = damage;
    result.npcHpAfter = healthAfter;
    result.npcDied = died;
    logger.info(`[NpcCombat] ${attacker.username} impactó a "${npc.type_display_name}" #${npcId} (resultado ${outcomeRoll}) → -${damage} HP (${npc.current_hp}→${healthAfter})`);
  }

  if (result.npcDied) {
    const { drops } = await resolveNpcDeath(npcId, { client });
    result.drops = drops;
    return result;
  }

  result.npcCounterattack = await resolveNpcCounterattack(client, attackerDiscordId, npc);

  return result;
}

export async function resolveNpcCounterattack(client, attackerDiscordId, npc) {
  const attacker = await getCombatant(attackerDiscordId);

  if (await _hasCombatProtection(attacker) || await _tilePreventsCombat(npc.coord_x, npc.coord_y)) {
    return null;
  }

  const healResult = await resolveNpcHealAttempt(npc);
  if (healResult) {
    return {
      distance: null, rangeRoll: null, inRange: false,
      outcomeRoll: null, hit: false, damage: 0,
      playerHpAfter: attacker.hp, playerKilled: false, immortalitySaved: false,
      heal: healResult,
    };
  }

  const { primary, secondary } = await resolveNpcWeapons(npc);
  if (!primary && !secondary) return null;

  const distance = chebyshevGridDistance(attacker, npc);
  const npcWeapon = _applyMountDamageBonus(selectNpcCombatWeapon(primary, secondary, distance), npc);
  const { rangeRoll, inRange } = rollRangeCheckForNpcCombat(npcWeapon, distance);

  const counterRoll = inRange ? rollDie(6) : null;
  const counter = {
    distance, rangeRoll, inRange,
    outcomeRoll: counterRoll, hit: false, damage: 0,
    playerHpAfter: attacker.hp, playerKilled: false, immortalitySaved: false,
    heal: null,
  };

  if (!inRange) {
    logger.info(
      `[NpcCombat] "${npc.type_display_name}" #${npc.id} intentó contraatacar a ${attacker.username} ` +
      `(distancia ${distance}) → NO LE ALCANZA`
    );
    return counter;
  }

  if (counterRoll >= 3) {
    counter.hit = true;
    const damage = applyOutcomeModifier(npcWeapon.weapon_damage ?? 0, counterRoll);
    const rawHp = Math.max(0, Math.min(MAX_HP, attacker.hp - damage));
    const newHp = _clampIfImmortal(attacker, rawHp);
    counter.damage = damage;
    counter.playerHpAfter = newHp;
    counter.immortalitySaved = rawHp <= 0 && newHp > 0;

    if (newHp <= 0) {
      await markDeceased(client, attackerDiscordId, `herido de muerte por ${npc.type_display_name} en (${npc.coord_x},${npc.coord_y})`);
      counter.playerKilled = true;
    } else {
      await updateStats(attackerDiscordId, { hp: newHp });
    }
  }

  logger.info(`[NpcCombat] "${npc.type_display_name}" #${npc.id} contraatacó a ${attacker.username} (tirada ${counterRoll})${counter.hit ? ` → -${counter.damage} HP` : ' → falla'}`);
  return counter;
}

export async function resolveTileDefenders(client, attackerDiscordId, x, y) {
  const attacker = await getCombatant(attackerDiscordId);
  const soldiers = (await getSoldierNpcsAtTile(x, y))
    .filter(s => s.owner_player_id !== attacker?.id);
  const results = [];

  for (const soldier of soldiers) {
    const armed = { ...soldier, weapon_item_id: soldier.equipped_tool_item_id ?? soldier.weapon_item_id };
    const counter = await resolveNpcCounterattack(client, attackerDiscordId, armed);
    if (counter) results.push({ npc: soldier, counter });
    if (counter?.playerKilled) break;
  }

  return results;
}
