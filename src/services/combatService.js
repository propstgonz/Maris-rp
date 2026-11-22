import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { config, MAX_HP } from '../utils/permissions.js';
import { isConstructionRuined } from '../utils/sql.js';
import { chebyshevGridDistance } from '../utils/geometry.js';
import { rollDie } from '../utils/dice.js';
import { updateStats, applyEffect, findPlayerById } from './playerService.js';
import { getEffectType } from './effectTypesService.js';
import { getSetting, setSetting } from './settingsService.js';
import { discordTimestamp, discordRelativeFromNow } from '../utils/embeds.js';
import { markDeceased } from './characterLifecycleService.js';
import { sendPlayerAlert } from './playerAlertService.js';
import { removeItem, hasEnough } from './inventoryService.js';
import { resolveConstructionAtTile, damageConstruction, getTileWithDetails } from './mapService.js';
import { buildAttackMenuRow } from '../utils/attackButtons.js';

const MELEE_DAMAGE    = config.game?.meleeDamage    ?? 1;
const MELEE_SELF_DMG  = config.game?.meleeSelfDamage ?? 1;

const DEFAULT_ATTACK_MAX_PER_DAY     = 0;
const DEFAULT_ATTACK_COOLDOWN_HOURS  = 0;

const SQL = {
  getPlayer: `
    SELECT id, discord_id, username, character_name, character_created_at,
           coord_x, coord_y, hp, is_alive, modmail_channel_id, is_immortal
    FROM ${T.players} WHERE discord_id = ?
  `,

  getAttackRateInfo: `
    SELECT
      attacks_today_count,
      (attacks_today_date IS NOT NULL AND attacks_today_date = CURDATE()) AS is_today,
      CASE WHEN last_attack_at IS NULL THEN NULL
           ELSE TIMESTAMPDIFF(SECOND, last_attack_at, NOW()) / 3600.0 END AS hours_since_last_attack
    FROM ${T.players} WHERE id = ?
  `,
  claimAttackSlot: `
    UPDATE ${T.players}
    SET attacks_today_count = IF(attacks_today_date = CURDATE(), attacks_today_count, 0) + 1,
        attacks_today_date  = CURDATE(),
        last_attack_at      = NOW()
    WHERE id = ?
      AND (? = 0 OR last_attack_at IS NULL OR last_attack_at <= DATE_SUB(NOW(), INTERVAL ? SECOND))
      AND (? = 0 OR IF(attacks_today_date = CURDATE(), attacks_today_count, 0) < ?)
  `,

  getTilePreventsCombat: `
    SELECT et.prevents_combat
    FROM ${T.map_tiles} t
    JOIN ${T.effect_types} et ON et.name = t.effect_type
    WHERE t.coord_x = ? AND t.coord_y = ?
  `,

  getActivePreventsCombatEffect: `
    SELECT 1 FROM ${T.player_effects} pe
    JOIN ${T.effect_types} et ON et.name = pe.effect_type
    WHERE pe.player_id = ? AND et.prevents_combat = 1
      AND (pe.expires_at IS NULL OR pe.expires_at > NOW())
    LIMIT 1
  `,

  getWeaponsInInventory: `
    SELECT i.*, inv.quantity, inv.durability
    FROM ${T.items} i
    JOIN ${T.inventory} inv ON inv.item_id = i.id
    JOIN ${T.players} p     ON inv.player_id = p.id
    WHERE p.discord_id = ? AND i.item_type = 'arma' AND inv.quantity > 0
    ORDER BY i.display_name ASC
  `,

  getWeaponInInventory: `
    SELECT i.*, inv.quantity, inv.durability
    FROM ${T.items} i
    JOIN ${T.inventory} inv ON inv.item_id = i.id
    JOIN ${T.players} p     ON inv.player_id = p.id
    WHERE p.discord_id = ? AND i.name = ? AND i.item_type = 'arma'
  `,

  getOtherLivingPlayersAtTile: `
    SELECT id, discord_id, username, character_name, hp, is_immortal
    FROM ${T.players}
    WHERE coord_x = ? AND coord_y = ? AND is_alive = 1
      AND character_created_at IS NOT NULL AND discord_id != ?
  `,

  setDurability: `
    UPDATE ${T.inventory} SET durability = ? WHERE player_id = ? AND item_id = ?
  `,

  getItemByName: `SELECT * FROM ${T.items} WHERE name = ?`,
};

function computeDistance(a, b) {
  return chebyshevGridDistance({ coord_x: a.coord_x, coord_y: a.coord_y }, { coord_x: b.coord_x, coord_y: b.coord_y });
}

export async function getCombatant(discordId) {
  return (await queryOne(SQL.getPlayer, [discordId])) ?? null;
}

export async function getPlayerWeapon(discordId, weaponItemName) {
  return (await queryOne(SQL.getWeaponInInventory, [discordId, weaponItemName.toLowerCase().trim()])) ?? null;
}

export async function getPlayerWeapons(discordId) {
  return query(SQL.getWeaponsInInventory, [discordId]);
}

const RANGE_FACES = [1, 2, 3, 4, 5, 6];

export function weaponMaxRange(weapon) {
  let max = 0;
  for (const face of RANGE_FACES) {
    const value = weapon[`weapon_roll_${face}`];
    if (value !== null && value !== undefined && value > max) max = value;
  }
  return max;
}

export function rollRangeCheckForNpcCombat(weapon, distance) {
  if (weaponMaxRange(weapon) === 0) {
    return { rangeRoll: null, inRange: distance === 0, meleeOnly: true };
  }
  return { ..._rollRangeCheck(weapon, distance), meleeOnly: false };
}

function _weaponCouldReach(weapon, distance) {
  if (!weapon) return false;
  return weaponMaxRange(weapon) === 0 ? distance === 0 : weaponMaxRange(weapon) >= distance;
}

export function selectNpcCombatWeapon(primary, secondary, distance) {
  if (_weaponCouldReach(primary, distance)) return primary;
  if (_weaponCouldReach(secondary, distance)) return secondary;
  return primary ?? secondary ?? null;
}

export function weaponFacesReaching(weapon, distance) {
  let count = 0;
  for (const face of RANGE_FACES) {
    const value = weapon[`weapon_roll_${face}`];
    if (value !== null && value !== undefined && distance <= value) count++;
  }
  return count;
}

export async function getAttackLimits() {
  const maxPerDay = Number(await getSetting('attack_max_per_day', String(DEFAULT_ATTACK_MAX_PER_DAY)));
  const cooldownHours = Number(await getSetting('attack_cooldown_hours', String(DEFAULT_ATTACK_COOLDOWN_HOURS)));
  return {
    maxPerDay: Number.isFinite(maxPerDay) && maxPerDay >= 0 ? maxPerDay : DEFAULT_ATTACK_MAX_PER_DAY,
    cooldownHours: Number.isFinite(cooldownHours) && cooldownHours >= 0 ? cooldownHours : DEFAULT_ATTACK_COOLDOWN_HOURS,
  };
}

export async function getAttackAvailability(discordId) {
  const { maxPerDay, cooldownHours } = await getAttackLimits();
  if (maxPerDay <= 0 && cooldownHours <= 0) return { limited: false };

  const player = await queryOne(SQL.getPlayer, [discordId]);
  if (!player) return { limited: false };

  const info = await queryOne(SQL.getAttackRateInfo, [player.id]);
  const usedToday = info?.is_today ? info.attacks_today_count : 0;
  const cooldownRemainingSeconds = cooldownHours > 0 && info?.hours_since_last_attack !== null
    ? Math.max(0, Math.round((cooldownHours - info.hours_since_last_attack) * 3600))
    : 0;

  return {
    limited: true,
    maxPerDay,
    usedToday,
    remainingToday: maxPerDay > 0 ? Math.max(0, maxPerDay - usedToday) : null,
    cooldownRemainingSeconds,
  };
}

export async function setAttackLimits({ maxPerDay, cooldownHours } = {}) {
  if (maxPerDay !== undefined) {
    if (!Number.isFinite(maxPerDay) || maxPerDay < 0) {
      throw new Error('El máximo de ataques por día debe ser un número ≥ 0 (0 = sin límite).');
    }
    await setSetting('attack_max_per_day', String(maxPerDay));
  }
  if (cooldownHours !== undefined) {
    if (!Number.isFinite(cooldownHours) || cooldownHours < 0) {
      throw new Error('El cooldown entre ataques debe ser un número de horas ≥ 0 (0 = sin cooldown).');
    }
    await setSetting('attack_cooldown_hours', String(cooldownHours));
  }
  logger.info(`[Combat] Límites de ataque actualizados: ${JSON.stringify(await getAttackLimits())}`);
}

function _nextUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
}

export async function _checkAndRecordAttackRateLimit(attacker) {
  const { maxPerDay, cooldownHours } = await getAttackLimits();
  if (maxPerDay <= 0 && cooldownHours <= 0) return;

  const cooldownSeconds = Math.round(cooldownHours * 3600);
  const claimed = await execute(SQL.claimAttackSlot, [
    attacker.id, cooldownSeconds, cooldownSeconds, maxPerDay, maxPerDay,
  ]);
  if (claimed.changes > 0) return;

  const info = await queryOne(SQL.getAttackRateInfo, [attacker.id]);
  if (cooldownHours > 0 && info?.hours_since_last_attack !== null && info?.hours_since_last_attack < cooldownHours) {
    const remainingHours = cooldownHours - info.hours_since_last_attack;
    throw new Error(`Todavía no puedes volver a atacar — podrás ${discordRelativeFromNow(remainingHours * 3600)}.`);
  }
  throw new Error(`Ya has usado tus **${maxPerDay}** ataque(s) de hoy. Podrás volver a intentarlo ${discordTimestamp(_nextUtcMidnight(), 'R')}.`);
}

export async function _tilePreventsCombat(x, y) {
  return Boolean((await queryOne(SQL.getTilePreventsCombat, [x, y]))?.prevents_combat);
}

export async function _hasCombatProtection(player) {
  if (await _tilePreventsCombat(player.coord_x, player.coord_y)) return true;
  return Boolean(await queryOne(SQL.getActivePreventsCombatEffect, [player.id]));
}

async function _checkCombatZoneProtection(attacker, target) {
  if (await _hasCombatProtection(attacker)) {
    throw new Error('No puedes pelear ahora mismo — tienes un estado activo que impide el combate (o estás en una zona segura, como una casilla de aparición).');
  }
  if (await _hasCombatProtection(target)) {
    throw new Error(`No se puede atacar a **${target.character_name ?? target.username}** — tiene un estado activo que impide el combate (o está en una zona segura, como una casilla de aparición).`);
  }
}

async function resolveCombatants(attackerDiscordId, targetDiscordId) {
  if (attackerDiscordId === targetDiscordId) {
    throw new Error('No puedes atacarte a ti mismo.');
  }

  const attacker = await queryOne(SQL.getPlayer, [attackerDiscordId]);
  if (!attacker) throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!attacker.is_alive) throw new Error('No puedes atacar si tu personaje está muerto.');

  const target = await queryOne(SQL.getPlayer, [targetDiscordId]);
  if (!target) throw new Error('El jugador objetivo no está registrado.');
  if (!target.character_created_at) throw new Error('El jugador objetivo todavía no ha creado un personaje — no se le puede atacar.');
  if (!target.is_alive) throw new Error(`**${target.character_name ?? target.username}** ya está muerto.`);

  await _checkCombatZoneProtection(attacker, target);

  return { attacker, target };
}

export function _clampIfImmortal(entity, newHp) {
  return entity.is_immortal && newHp <= 0 ? 1 : newHp;
}

function _rollRangeCheck(weapon, distance) {
  const rangeRoll   = rollDie(6);
  const hitDistance = weapon[`weapon_roll_${rangeRoll}`];
  const inRange     = hitDistance !== null && distance <= hitDistance;
  return { rangeRoll, inRange };
}

export function applyOutcomeModifier(baseDamage, outcomeRoll) {
  switch (outcomeRoll) {
    case 3:  return Math.max(0, baseDamage - 1);
    case 5:  return baseDamage + 1;
    case 6:  return baseDamage * 2;
    case 4:
    default: return baseDamage;
  }
}

async function _applyAreaAttack(client, weapon, target, damage, targetDied, attacker) {
  const areaResult = { affectedPlayers: [], affectedConstructions: [], effectApplied: null };
  if (!weapon.weapon_area_damage) return areaResult;

  if (weapon.weapon_structure_damage) {
    const tile = await getTileWithDetails(target.coord_x, target.coord_y);
    const liveConstructions = (tile?.constructions ?? []).filter(c => !isConstructionRuined(c));
    for (const c of liveConstructions) {
      const { healthBefore, healthAfter, ruinedNow } = await damageConstruction(c.id, weapon.weapon_structure_damage);
      areaResult.affectedConstructions.push({ id: c.id, name: c.name, healthBefore, healthAfter, ruinedNow, builderDiscordId: c.builder_discord_id ?? null });

      if (c.builder_discord_id && c.builder_discord_id !== attacker.discord_id) {
        sendPlayerAlert(
          client, c.builder_discord_id, 'structureAttacked',
          `🏗️ **${c.name}** (${target.coord_x}, ${target.coord_y}) ha sido alcanzada por la onda expansiva de **${attacker.character_name ?? attacker.username}** con **${weapon.display_name}** ` +
          `— vida ${healthBefore}→${healthAfter}${ruinedNow ? ' — **EN RUINAS**' : ''}.\n` +
          `-# Puedes desactivar este aviso con \`/personaje alertas ataque:false\`.`
        ).catch(() => {});
      }
    }
  }

  const others = await query(SQL.getOtherLivingPlayersAtTile, [target.coord_x, target.coord_y, target.discord_id]);
  for (const other of others) {
    const isSelf = other.discord_id === attacker.discord_id;
    const rawHp = Math.max(0, Math.min(MAX_HP, other.hp - damage));
    const newHp = _clampIfImmortal(other, rawHp);
    const killed = newHp <= 0;

    if (killed) {
      await markDeceased(
        client, other.discord_id,
        isSelf
          ? `alcanzado por su propia onda expansiva de "${weapon.display_name}"`
          : `alcanzado por la onda expansiva de "${weapon.display_name}"`
      );
    } else {
      await updateStats(other.discord_id, { hp: newHp });
      sendPlayerAlert(
        client, other.discord_id, 'playerAttacked',
        isSelf
          ? `💥 Estabas en el radio de tu propia **${weapon.display_name}** — la onda expansiva te alcanza: ` +
            `-${damage} HP (${other.hp} → ${newHp}).`
          : `⚔️ **${attacker.character_name ?? attacker.username}** te alcanzó con el área de **${weapon.display_name}** — ` +
            `-${damage} HP (${other.hp} → ${newHp}).`,
        isSelf ? [] : [buildAttackMenuRow(other.discord_id, 'Contraatacar')]
      ).catch(() => {});
    }

    areaResult.affectedPlayers.push({
      discordId: other.discord_id, username: other.username,
      hpBefore: other.hp, hpAfter: newHp, killed, self: isSelf,
      immortalitySaved: rawHp <= 0 && newHp > 0,
    });

    logger.info(
      `[Combat] 💥 Área de "${weapon.display_name}" alcanza a ${other.username} en (${target.coord_x},${target.coord_y}) ` +
      `→ -${damage} HP (${other.hp}→${newHp})${killed ? ' (murió)' : ''}`
    );
  }

  if (weapon.weapon_area_effect) {
    const meta = await getEffectType(weapon.weapon_area_effect);
    if (meta) {
      const survivors = areaResult.affectedPlayers.filter(p => !p.killed).map(p => p.discordId);
      const allDiscordIds = targetDied ? survivors : [target.discord_id, ...survivors];
      for (const discordId of allDiscordIds) {
        try {
          await applyEffect(
            discordId,
            weapon.weapon_area_effect,
            meta.laburo_modifier  ?? 0,
            meta.hp_delta_per_day ?? 0,
            weapon.weapon_area_effect_duration_hours ?? null
          );
        } catch (err) {
          logger.warn(`[Combat] No se pudo aplicar el efecto de área "${weapon.weapon_area_effect}" a ${discordId}: ${err.message}`);
        }
      }
      areaResult.effectApplied = weapon.weapon_area_effect;
      logger.info(`[Combat] 🎭 Efecto de área "${weapon.weapon_area_effect}" aplicado a ${allDiscordIds.length} jugador(es) en (${target.coord_x},${target.coord_y}).`);
    } else {
      logger.warn(`[Combat] "${weapon.display_name}" tiene un weapon_area_effect="${weapon.weapon_area_effect}" que ya no existe en el catálogo — se omite.`);
    }
  }

  return areaResult;
}

export async function degradeWeaponDurability(attackerDiscordId, attackerPlayerId, weapon) {
  if (!weapon.weapon_max_durability) return { broke: false, durabilityAfter: null };

  const current = weapon.durability ?? weapon.weapon_max_durability;
  const next = current - 1;

  if (next <= 0) {
    const { newQuantity } = await removeItem(attackerDiscordId, weapon.name, 1);
    if (newQuantity > 0) {
      await execute(SQL.setDurability, [weapon.weapon_max_durability, attackerPlayerId, weapon.id]);
    }
    logger.info(`[Combat] 🔨 "${weapon.display_name}" de ${attackerDiscordId} se ha roto y se destruyó 1 unidad (quedan ${newQuantity}).`);
    return { broke: true, durabilityAfter: 0 };
  }

  await execute(SQL.setDurability, [next, attackerPlayerId, weapon.id]);
  return { broke: false, durabilityAfter: next };
}

export async function _consumeAmmoIfNeeded(attackerDiscordId, weapon) {
  if (!weapon.weapon_ammo_item_name) return null;

  if (weapon.weapon_ammo_item_name === 'laburo') {
    throw new Error(
      `**${weapon.display_name}** tiene el Laburo mal configurado como munición — avisa a Staff (\`/item arma\` para corregirlo).`
    );
  }

  const ammoCost = weapon.weapon_ammo_cost ?? 1;
  if (!(await hasEnough(attackerDiscordId, weapon.weapon_ammo_item_name, ammoCost))) {
    const ammoItem = await queryOne(SQL.getItemByName, [weapon.weapon_ammo_item_name]);
    throw new Error(
      `No te queda munición para **${weapon.display_name}**: necesitas **${ammoCost}** de ` +
      `**${ammoItem?.display_name ?? weapon.weapon_ammo_item_name}** y no tienes suficiente.`
    );
  }

  const { newQuantity } = await removeItem(attackerDiscordId, weapon.weapon_ammo_item_name, ammoCost);
  return { name: weapon.weapon_ammo_item_name, cost: ammoCost, remaining: newQuantity };
}

export async function _claimAttackCost(attacker, attackerDiscordId, weapon) {
  return withTransaction(async () => {
    await _checkAndRecordAttackRateLimit(attacker);
    return _consumeAmmoIfNeeded(attackerDiscordId, weapon);
  });
}

export async function resolveAttack(client, attackerDiscordId, targetDiscordId, weaponItemName) {
  const { attacker, target } = await resolveCombatants(attackerDiscordId, targetDiscordId);

  const weapon = await queryOne(SQL.getWeaponInInventory, [attackerDiscordId, weaponItemName.toLowerCase().trim()]);
  if (!weapon || weapon.quantity < 1) {
    throw new Error(`No tienes **${weaponItemName}** en tu inventario (o no es un arma).`);
  }

  const ammoConsumed = await _claimAttackCost(attacker, attackerDiscordId, weapon);

  const distance = computeDistance(attacker, target);
  const { rangeRoll, inRange } = _rollRangeCheck(weapon, distance);

  const result = {
    attacker, target, weapon, distance,
    rangeRoll, inRange,
    outcomeRoll: null, hit: false,
    damage: 0, targetHpAfter: target.hp, killed: false, immortalitySaved: false,
    weaponBroke: false, weaponDurabilityAfter: weapon.durability ?? null,
    ammoConsumed,
    area: { affectedPlayers: [], affectedConstructions: [], effectApplied: null },
  };

  if (!inRange) {
    logger.info(
      `[Combat] ${attacker.username} atacó a ${target.username} con "${weapon.name}" ` +
      `(distancia ${distance}, tirada de alcance ${rangeRoll}) → FUERA DE ALCANCE`
    );
    return result;
  }

  const outcomeRoll = rollDie(6);
  result.outcomeRoll = outcomeRoll;

  if (outcomeRoll === 1) {
    const { broke, durabilityAfter } = await degradeWeaponDurability(attackerDiscordId, attacker.id, weapon);
    result.weaponBroke = broke;
    result.weaponDurabilityAfter = durabilityAfter;
    logger.info(
      `[Combat] ${attacker.username} atacó a ${target.username} con "${weapon.name}" ` +
      `(dentro de alcance, tirada de resultado 1) → FALLA Y DAÑA EL ARMA` +
      `${broke ? ' (se ha roto)' : ` (durabilidad: ${durabilityAfter})`}`
    );
    return result;
  }

  if (outcomeRoll === 2) {
    logger.info(
      `[Combat] ${attacker.username} atacó a ${target.username} con "${weapon.name}" ` +
      `(dentro de alcance, tirada de resultado 2) → FALLA`
    );
    return result;
  }

  result.hit = true;
  const damage   = applyOutcomeModifier(weapon.weapon_damage ?? 0, outcomeRoll);
  const rawHp    = Math.max(0, Math.min(MAX_HP, target.hp - damage));
  const newHp    = _clampIfImmortal(target, rawHp);
  const savedByImmortality = rawHp <= 0 && newHp > 0;

  result.damage           = damage;
  result.targetHpAfter    = newHp;
  result.immortalitySaved = savedByImmortality;

  logger.info(
    `[Combat] ${attacker.username} impactó a ${target.username} con "${weapon.name}" ` +
    `(tirada de resultado ${outcomeRoll}) → -${damage} HP (${target.hp}→${newHp})` +
    `${savedByImmortality ? ' — salvado por inmortalidad' : ''}`
  );

  if (newHp <= 0) {
    await markDeceased(
      client,
      targetDiscordId,
      `herido de muerte por ${attacker.character_name ?? attacker.username} con ${weapon.display_name}`
    );
    result.killed = true;
  } else {
    await updateStats(targetDiscordId, { hp: newHp });
    sendPlayerAlert(
      client, targetDiscordId, 'playerAttacked',
      `⚔️ **${attacker.character_name ?? attacker.username}** te ha atacado con **${weapon.display_name}** — ` +
      `-${damage} HP (${target.hp} → ${newHp}).`,
      [buildAttackMenuRow(targetDiscordId, 'Contraatacar')]
    ).catch(() => {});
  }

  result.area = await _applyAreaAttack(client, weapon, target, damage, result.killed, attacker);

  return result;
}

export async function resolveMeleeAttack(client, attackerDiscordId, targetDiscordId) {
  const { attacker, target } = await resolveCombatants(attackerDiscordId, targetDiscordId);

  const distance = computeDistance(attacker, target);
  if (distance !== 0) {
    throw new Error('Para pelear cuerpo a cuerpo tienes que estar en la **misma casilla** que tu objetivo.');
  }
  await _checkAndRecordAttackRateLimit(attacker);

  const outcomeRoll = rollDie(6);
  const result = {
    attacker, target, distance,
    outcomeRoll, hit: false,
    damage: 0, targetHpAfter: target.hp, killed: false, immortalitySaved: false,
    selfDamage: 0, attackerHpAfter: attacker.hp, attackerKilled: false, attackerImmortalitySaved: false,
  };

  if (outcomeRoll === 1) {
    const rawAttackerHp = Math.max(0, attacker.hp - MELEE_SELF_DMG);
    const newAttackerHp = _clampIfImmortal(attacker, rawAttackerHp);
    result.selfDamage             = MELEE_SELF_DMG;
    result.attackerHpAfter        = newAttackerHp;
    result.attackerImmortalitySaved = rawAttackerHp <= 0 && newAttackerHp > 0;

    logger.info(
      `[Combat] ${attacker.username} peleó cuerpo a cuerpo contra ${target.username} ` +
      `(tirada de resultado 1) → FALLA Y SE HACE DAÑO (${attacker.hp}→${newAttackerHp})` +
      `${rawAttackerHp <= 0 && newAttackerHp > 0 ? ' — salvado por inmortalidad' : ''}`
    );

    if (newAttackerHp <= 0) {
      await markDeceased(
        client,
        attackerDiscordId,
        `se hizo daño a sí mismo peleando cuerpo a cuerpo contra ${target.character_name ?? target.username}`
      );
      result.attackerKilled = true;
    } else {
      await updateStats(attackerDiscordId, { hp: newAttackerHp });
    }
    return result;
  }

  if (outcomeRoll === 2) {
    logger.info(
      `[Combat] ${attacker.username} peleó cuerpo a cuerpo contra ${target.username} ` +
      `(tirada de resultado 2) → FALLA`
    );
    return result;
  }

  result.hit = true;
  const damage = applyOutcomeModifier(MELEE_DAMAGE, outcomeRoll);
  const rawHp  = Math.max(0, Math.min(MAX_HP, target.hp - damage));
  const newHp  = _clampIfImmortal(target, rawHp);

  result.damage           = damage;
  result.targetHpAfter    = newHp;
  result.immortalitySaved = rawHp <= 0 && newHp > 0;

  logger.info(
    `[Combat] ${attacker.username} golpeó cuerpo a cuerpo a ${target.username} ` +
    `(tirada de resultado ${outcomeRoll}) → -${damage} HP (${target.hp}→${newHp})` +
    `${result.immortalitySaved ? ' — salvado por inmortalidad' : ''}`
  );

  if (newHp <= 0) {
    await markDeceased(
      client,
      targetDiscordId,
      `herido de muerte a golpes por ${attacker.character_name ?? attacker.username}`
    );
    result.killed = true;
  } else {
    await updateStats(targetDiscordId, { hp: newHp });
    sendPlayerAlert(
      client, targetDiscordId, 'playerAttacked',
      `⚔️ **${attacker.character_name ?? attacker.username}** te ha atacado cuerpo a cuerpo — ` +
      `-${damage} HP (${target.hp} → ${newHp}).`,
      [buildAttackMenuRow(targetDiscordId, 'Contraatacar')]
    ).catch(() => {});
  }

  return result;
}

export async function resolveStructureAttack(client, attackerDiscordId, x, y, constructionType, weaponItemName, constructionId = null) {
  const attacker = await queryOne(SQL.getPlayer, [attackerDiscordId]);
  if (!attacker) throw new Error('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!attacker.is_alive) throw new Error('No puedes atacar si tu personaje está muerto.');

  const weapon = await queryOne(SQL.getWeaponInInventory, [attackerDiscordId, weaponItemName.toLowerCase().trim()]);
  if (!weapon || weapon.quantity < 1) {
    throw new Error(`No tienes **${weaponItemName}** en tu inventario (o no es un arma).`);
  }
  if (!weapon.weapon_structure_damage) {
    throw new Error(
      `**${weapon.display_name}** no puede dañar construcciones — un Staff puede activárselo con \`/item arma dano_estructura:N\`.`
    );
  }

  const construction = await resolveConstructionAtTile(x, y, constructionType, constructionId);

  if (await _hasCombatProtection(attacker)) {
    throw new Error('No puedes atacar ahora mismo — tienes un estado activo que impide el combate (o estás en una zona segura, como una casilla de aparición).');
  }
  if (await _tilePreventsCombat(x, y)) {
    throw new Error(`No se puede atacar **${construction.name}** — está en una zona segura donde el combate está bloqueado.`);
  }

  const maxHealth = construction.ct_max_health ?? 10;
  if ((construction.current_health ?? maxHealth) <= 0) {
    throw new Error(`**${construction.name}** ya está en ruinas — no queda nada más que destruir ahí.`);
  }

  const ammoConsumed = await _claimAttackCost(attacker, attackerDiscordId, weapon);

  const distance = computeDistance(attacker, { coord_x: construction.coord_x, coord_y: construction.coord_y });
  const { rangeRoll, inRange } = _rollRangeCheck(weapon, distance);

  const result = {
    attacker, construction, weapon, distance,
    rangeRoll, inRange,
    outcomeRoll: null, hit: false,
    damage: 0, healthBefore: construction.current_health ?? maxHealth, healthAfter: construction.current_health ?? maxHealth, ruinedNow: false,
    weaponBroke: false, weaponDurabilityAfter: weapon.durability ?? null,
    ammoConsumed,
  };

  if (!inRange) {
    logger.info(
      `[Combat] ${attacker.username} atacó la construcción "${construction.name}" @ (${x},${y}) con "${weapon.name}" ` +
      `(distancia ${distance}, tirada de alcance ${rangeRoll}) → FUERA DE ALCANCE`
    );
    return result;
  }

  const outcomeRoll = rollDie(6);
  result.outcomeRoll = outcomeRoll;

  if (outcomeRoll === 1) {
    const { broke, durabilityAfter } = await degradeWeaponDurability(attackerDiscordId, attacker.id, weapon);
    result.weaponBroke = broke;
    result.weaponDurabilityAfter = durabilityAfter;
    logger.info(
      `[Combat] ${attacker.username} atacó la construcción "${construction.name}" @ (${x},${y}) con "${weapon.name}" ` +
      `(dentro de alcance, tirada de resultado 1) → FALLA Y DAÑA EL ARMA` +
      `${broke ? ' (se ha roto)' : ` (durabilidad: ${durabilityAfter})`}`
    );
    return result;
  }

  if (outcomeRoll === 2) {
    logger.info(
      `[Combat] ${attacker.username} atacó la construcción "${construction.name}" @ (${x},${y}) con "${weapon.name}" ` +
      `(dentro de alcance, tirada de resultado 2) → FALLA`
    );
    return result;
  }

  result.hit = true;
  const damage = applyOutcomeModifier(weapon.weapon_structure_damage, outcomeRoll);
  const { healthBefore, healthAfter, ruinedNow } = await damageConstruction(construction.id, damage);

  result.damage       = damage;
  result.healthBefore = healthBefore;
  result.healthAfter  = healthAfter;
  result.ruinedNow    = ruinedNow;

  logger.info(
    `[Combat] ${attacker.username} impactó la construcción "${construction.name}" @ (${x},${y}) con "${weapon.name}" ` +
    `(tirada de resultado ${outcomeRoll}) → -${damage} vida (${healthBefore}→${healthAfter})${ruinedNow ? ' — EN RUINAS' : ''}`
  );

  if (construction.built_by_player_id && construction.built_by_player_id !== attacker.id) {
    const owner = await findPlayerById(construction.built_by_player_id);
    if (owner) {
      sendPlayerAlert(
        client, owner.discord_id, 'structureAttacked',
        `🏗️ **${construction.name}** (${x}, ${y}) ha sido atacada por **${attacker.character_name ?? attacker.username}** con **${weapon.display_name}** ` +
        `— vida ${healthBefore}→${healthAfter}${ruinedNow ? ' — **EN RUINAS**' : ''}.\n` +
        `-# Puedes desactivar este aviso con \`/personaje alertas ataque:false\`.`
      ).catch(() => {});
    }
  }

  return result;
}
