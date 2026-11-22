import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { resolveAttack, resolveMeleeAttack, resolveStructureAttack } from '../../services/combatService.js';
import { resolveAttackOnNpc, resolveTileDefenders } from '../../services/npcCombatService.js';
import { getNpcsAtTile } from '../../services/npcService.js';
import { resolveEncounterIfConcluded } from '../../services/npcEncounterService.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getConstructionTypeByName } from '../../services/constructionTypeService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { buildAttackKindMessage } from '../../components/attackFlow.js';
import { buildAttackMenuRow } from '../../utils/attackButtons.js';
import { combatPhrase } from '../../utils/combatNarrative.js';
import { COLORS }        from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { handleItemAutocomplete, handleConstructionTypeAutocomplete } from '../../utils/autocomplete.js';
import { logAction }      from '../../services/auditLogService.js';
import logger             from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('attack')
    .setDescription('Ataca a otro jugador o a una construcción — sin opciones, abre el menú guiado')
    .addUserOption(opt => opt.setName('jugador').setDescription('Jugador objetivo — con arma a distancia, o cuerpo a cuerpo si omites el arma').setRequired(false))
    .addStringOption(opt => opt.setName('arma').setDescription('Arma de tu inventario (omite para cuerpo a cuerpo contra un jugador)').setRequired(false).setAutocomplete(true))
    .addStringOption(opt => opt.setName('tipo').setDescription('Tipo de construcción a atacar (requiere `arma`)').setRequired(false).setAutocomplete(true))
    .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X de la construcción (solo con `tipo`, omite x e y para tu propia casilla)').setRequired(false))
    .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y de la construcción (solo con `tipo`, omite x e y para tu propia casilla)').setRequired(false))
    .addIntegerOption(opt => opt.setName('id').setDescription('Cuál, si hay varias del mismo tipo en la casilla (solo con `tipo`)').setRequired(false).setMinValue(1)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'tipo') {
      await handleConstructionTypeAutocomplete(interaction);
    } else {
      await handleItemAutocomplete(interaction, { onlyWeapons: true });
    }
  },

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const targetUser = interaction.options.getUser('jugador');
    const weaponName  = interaction.options.getString('arma')?.toLowerCase().trim() || null;
    const tipo        = interaction.options.getString('tipo');

    if (!targetUser && !tipo) {
      return interaction.reply(await buildAttackKindMessage(interaction.user.id));
    }
    if (targetUser && tipo) {
      return interaction.reply({ content: '❌ Da `jugador` o `tipo`, no los dos a la vez — son ataques distintos.', flags: MessageFlags.Ephemeral });
    }
    if (tipo) {
      if (!weaponName) {
        return interaction.reply({ content: '❌ Atacar una construcción requiere indicar `arma`.', flags: MessageFlags.Ephemeral });
      }
      return executeStructureAttack(interaction);
    }

    return weaponName
      ? executeRangedAttack(interaction, targetUser, weaponName)
      : executeMeleeAttack(interaction, targetUser);
  },
};

function outcomeLabel(outcomeRoll) {
  switch (outcomeRoll) {
    case 1: return '1 — Falla y daña el arma / a ti mismo';
    case 2: return '2 — Falla';
    case 3: return '3 — Impacto flojo';
    case 4: return '4 — Impacto normal';
    case 5: return '5 — Buen impacto';
    case 6: return '6 — ¡Crítico!';
    default: return `${outcomeRoll}`;
  }
}

async function appendTileDefenders(interaction, embed, x, y) {
  try {
    const defenderName = interaction.member?.displayName ?? interaction.user.username;
    const defenses = await resolveTileDefenders(interaction.client, interaction.user.id, x, y);
    if (defenses.length === 0) return;
    for (const { npc, counter } of defenses) {
      if (!counter.hit) continue;
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'combat.npc_counterattack_hit', target: interaction.user.id,
        details: {
          npcId: npc.id, npcType: npc.type_display_name,
          damage: counter.damage, playerHpAfter: counter.playerHpAfter,
          playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
        },
      });
    }
    embed.addFields({
      name: '🛡️ Defensa automática',
      value: defenses.map(({ npc, counter }) =>
        counter.heal
          ? `💊 **${npc.type_display_name}** usa **${counter.heal.item.display_name}** en ${counter.heal.isSelf ? 'sí mismo' : `**${counter.heal.target.type_display_name}**`} (+${counter.heal.healthAfter - counter.heal.healthBefore} HP) en vez de atacar.`
          : counter.inRange
          ? `${counter.hit ? combatPhrase({ category: 'unarmed', outcome: counter.outcomeRoll === 6 ? 'crit' : 'hit', attacker: npc.type_display_name, target: defenderName }) : `${npc.type_emoji ?? '👤'} **${npc.type_display_name}** contraataca`} — ${counter.hit ? `-${counter.damage} HP${counter.playerKilled ? ' 💀 te ha matado' : ''}` : 'falla'}`
          : `${npc.type_emoji ?? '👤'} **${npc.type_display_name}** no llega a alcanzarte`
      ).join('\n'),
    });
  } catch (err) {
    logger.error(`[Attack] Error resolviendo defensores en (${x},${y}): ${err.message}`);
  }
}

export async function executeRangedAttack(interaction, targetUser, weaponName) {
  let result;
  try {
    result = await resolveAttack(interaction.client, interaction.user.id, targetUser.id, weaponName);
  } catch (err) {
    return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  const {
    attacker, target, weapon, distance, rangeRoll, inRange, outcomeRoll, hit,
    damage, targetHpAfter, killed, weaponBroke, weaponDurabilityAfter, ammoConsumed,
    immortalitySaved, area,
  } = result;

  const attackerName = attacker.character_name ?? attacker.username;
  const targetName    = target.character_name ?? target.username;
  const phrase = (outcome) => combatPhrase({ category: 'weapon', outcome, attacker: attackerName, target: targetName, weapon: weapon.display_name });

  logger.info(
    `[/attack jugador] ${interaction.user.tag} → ${targetUser.tag} con "${weapon.name}" ` +
    `(dist ${distance}, alcance ${rangeRoll}${inRange ? ` dentro, resultado ${outcomeRoll}` : ' fuera'}) → ` +
    `${hit ? `IMPACTO -${damage} HP` : 'FALLO'}`
  );

  if (hit) {
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'combat.ranged_hit', target: targetUser.id,
      details: { weapon: weapon.name, damage, targetHpAfter, killed, immortalitySaved },
    });
    for (const c of area.affectedConstructions) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'tile.construction_attack', target: `(${target.coord_x},${target.coord_y})`,
        details: { constructionId: c.id, constructionName: c.name, weapon: weapon.name, healthBefore: c.healthBefore, healthAfter: c.healthAfter, ruinedNow: c.ruinedNow, viaAreaAttack: true },
      });
    }
    for (const p of area.affectedPlayers) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'combat.area_hit', target: p.discordId,
        details: { weapon: weapon.name, hpBefore: p.hpBefore, hpAfter: p.hpAfter, killed: p.killed, immortalitySaved: p.immortalitySaved },
      });
    }
  }

  const embed = new EmbedBuilder()
    .setColor(hit ? COLORS.RED : COLORS.GREY)
    .setTitle(hit ? `${weapon.emoji ?? '🔫'} ¡Impacto!` : `${weapon.emoji ?? '🔫'} Disparo fallido`)
    .addFields(
      { name: '🎯 Atacante',       value: `**${attacker.character_name ?? attacker.username}**`, inline: true },
      { name: '🛡️ Objetivo',       value: `**${target.character_name ?? target.username}**`,     inline: true },
      { name: '🔫 Arma',           value: `${weapon.emoji ?? '🔫'} ${weapon.display_name}`,        inline: true },
      { name: '📏 Distancia',      value: `${distance} casilla${distance !== 1 ? 's' : ''}`,        inline: true },
      { name: '🎲 Tirada de alcance', value: `${rangeRoll} / 6 → ${inRange ? '**dentro de alcance**' : '*fuera de alcance*'}`, inline: true }
    )
    .setTimestamp();

  if (ammoConsumed) {
    embed.addFields({ name: '🔹 Munición', value: `-${ammoConsumed.cost} (quedan: ${ammoConsumed.remaining})`, inline: true });
  }

  if (!inRange) {
    embed.setDescription(`${phrase('miss')}\n\nEl disparo no alcanzó al objetivo — la distancia no coincidía con esta tirada.`);
    const weaponThumb = buildAssetUrl(weapon.image_filename, '/attack');
    if (weaponThumb) embed.setThumbnail(weaponThumb);
    return interaction.reply({ embeds: [embed] });
  }

  embed.addFields({ name: '🎲 Tirada de resultado', value: outcomeLabel(outcomeRoll), inline: true });

  if (outcomeRoll === 1) {
    embed.setDescription(
      `${phrase('weaponBreak')}\n\n` +
      (weaponBroke
        ? `💥 **${weapon.display_name}** se ha roto por el uso — se ha perdido 1 unidad del inventario.`
        : `🔧 **${weapon.display_name}** se ha dañado un poco *(durabilidad: ${weaponDurabilityAfter})*.`)
    );
  } else if (outcomeRoll === 2) {
    embed.setDescription(`${phrase('miss')}\n\nEl disparo falló, sin más consecuencias.`);
  } else {
    embed.addFields(
      { name: '💥 Daño', value: `-${damage} HP`, inline: true },
      { name: '❤️ HP restante', value: `${targetHpAfter}`, inline: true }
    );
    const hitPhrase = phrase(outcomeRoll === 6 ? 'crit' : 'hit');
    if (killed) {
      embed.setDescription(
        `${hitPhrase}\n\n💀 **${target.character_name ?? target.username}** ha muerto por este ataque. ` +
        `Staff tiene 7 días para revivirlo antes del borrado automático (o puede rendirse antes con \`/personaje rendirse\`).`
      );
    } else if (immortalitySaved) {
      embed.setDescription(`${hitPhrase}\n\n♾️ **${target.character_name ?? target.username}** es inmortal — el golpe habría sido letal, pero se ha clampeado a 1 HP.`);
    } else {
      embed.setDescription(hitPhrase);
    }

    if (area && (area.affectedPlayers.length > 0 || area.affectedConstructions.length > 0 || area.effectApplied)) {
      const lines = [];
      for (const p of area.affectedPlayers) {
        lines.push(
          `👤 **${p.username}**: -${p.hpBefore - p.hpAfter} HP (${p.hpBefore}→${p.hpAfter})` +
          `${p.killed ? ' 💀 murió' : p.immortalitySaved ? ' ♾️ salvado por inmortalidad' : ''}`
        );
      }
      for (const c of area.affectedConstructions) {
        lines.push(`🏗️ **${c.name}**: -${c.healthBefore - c.healthAfter} vida (${c.healthBefore}→${c.healthAfter})${c.ruinedNow ? ' 🏚️ en ruinas' : ''}`);
      }
      if (area.effectApplied) {
        lines.push(`🎭 Estado \`${area.effectApplied}\` aplicado a todos los de la casilla`);
      }
      embed.addFields({ name: '💥 Onda expansiva — resto de la casilla', value: lines.join('\n') });
    }
  }

  const weaponThumb = buildAssetUrl(weapon.image_filename, '/attack');
  if (weaponThumb) embed.setThumbnail(weaponThumb);

  if (hit) await appendTileDefenders(interaction, embed, target.coord_x, target.coord_y);

  return interaction.reply({ embeds: [embed] });
}

export async function executeMeleeAttack(interaction, targetUser) {
  let result;
  try {
    result = await resolveMeleeAttack(interaction.client, interaction.user.id, targetUser.id);
  } catch (err) {
    return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  const {
    attacker, target, outcomeRoll, hit, damage, targetHpAfter, killed,
    selfDamage, attackerHpAfter, attackerKilled,
    immortalitySaved, attackerImmortalitySaved,
  } = result;

  const attackerName = attacker.character_name ?? attacker.username;
  const targetName    = target.character_name ?? target.username;
  const phrase = (outcome) => combatPhrase({ category: 'unarmed', outcome, attacker: attackerName, target: targetName });

  logger.info(
    `[/attack jugador melee] ${interaction.user.tag} → ${targetUser.tag} (resultado ${outcomeRoll}) → ` +
    `${hit ? `IMPACTO -${damage} HP` : outcomeRoll === 1 ? `FALLO, -${selfDamage} HP propio` : 'FALLO'}`
  );

  if (hit || outcomeRoll === 1) {
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'combat.melee_hit', target: targetUser.id,
      details: hit
        ? { damage, targetHpAfter, killed, immortalitySaved }
        : { selfInflicted: true, selfDamage, attackerHpAfter, attackerKilled, attackerImmortalitySaved },
    });
  }

  const embed = new EmbedBuilder()
    .setColor(hit ? COLORS.RED : COLORS.GREY)
    .setTitle(hit ? '👊 ¡Impacto cuerpo a cuerpo!' : '👊 Golpe fallido')
    .addFields(
      { name: '🎯 Atacante', value: `**${attacker.character_name ?? attacker.username}**`, inline: true },
      { name: '🛡️ Objetivo', value: `**${target.character_name ?? target.username}**`,     inline: true },
      { name: '🎲 Tirada de resultado', value: outcomeLabel(outcomeRoll), inline: true }
    )
    .setTimestamp();

  if (outcomeRoll === 1) {
    let desc = `${phrase('selfHarm')}\n\nEl golpe falla y **${attackerName}** se hace daño con el impulso ` +
      `*(-${selfDamage} HP, ahora ${attackerHpAfter})*.`;
    if (attackerKilled) {
      desc += `\n\n💀 **${attackerName}** ha muerto por el golpe fallido. ` +
        `Staff tiene 7 días para revivirlo (o puede rendirse antes con \`/personaje rendirse\`).`;
    } else if (attackerImmortalitySaved) {
      desc += `\n\n♾️ **${attackerName}** es inmortal — el golpe habría sido fatal, pero se ha clampeado a 1 HP.`;
    }
    embed.setDescription(desc);
  } else if (outcomeRoll === 2) {
    embed.setDescription(`${phrase('miss')}\n\nEl golpe no acierta, sin más consecuencias.`);
  } else {
    embed.addFields(
      { name: '💥 Daño', value: `-${damage} HP`, inline: true },
      { name: '❤️ HP restante', value: `${targetHpAfter}`, inline: true }
    );
    const hitPhrase = phrase(outcomeRoll === 6 ? 'crit' : 'hit');
    if (killed) {
      embed.setDescription(
        `${hitPhrase}\n\n💀 **${targetName}** ha muerto por este golpe. ` +
        `Staff tiene 7 días para revivirlo antes del borrado automático (o puede rendirse antes con \`/personaje rendirse\`).`
      );
    } else if (immortalitySaved) {
      embed.setDescription(`${hitPhrase}\n\n♾️ **${targetName}** es inmortal — el golpe habría sido letal, pero se ha clampeado a 1 HP.`);
    } else {
      embed.setDescription(hitPhrase);
    }
  }

  if (hit) await appendTileDefenders(interaction, embed, target.coord_x, target.coord_y);

  return interaction.reply({ embeds: [embed] });
}

export async function executeStructureAttack(interaction) {
  const tipo   = interaction.options.getString('tipo', true).toLowerCase().trim();
  const weaponName = interaction.options.getString('arma', true).toLowerCase().trim();
  const constructionId = interaction.options.getInteger('id');

  let x = interaction.options.getInteger('x');
  let y = interaction.options.getInteger('y');
  if (x === null && y === null) {
    const player = await getPlayerByDiscordId(interaction.user.id);
    if (!player) {
      return interaction.reply({ content: '❌ Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.', flags: MessageFlags.Ephemeral });
    }
    x = player.coord_x;
    y = player.coord_y;
  } else if (x === null || y === null) {
    return interaction.reply({ content: '❌ Si das una coordenada, tienes que dar las dos (x e y) — o ninguna, para atacar en tu propia casilla.', flags: MessageFlags.Ephemeral });
  }

  const constructionType = await getConstructionTypeByName(tipo);
  if (!constructionType) {
    return interaction.reply({
      content: `❌ No existe ningún tipo de construcción llamado \`${tipo}\`. Usa \`/build list\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  let result;
  try {
    result = await resolveStructureAttack(interaction.client, interaction.user.id, x, y, constructionType, weaponName, constructionId);
  } catch (err) {
    return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  const {
    attacker, construction, weapon, distance, rangeRoll, inRange, outcomeRoll, hit,
    damage, healthBefore, healthAfter, ruinedNow, weaponBroke, weaponDurabilityAfter, ammoConsumed,
  } = result;

  const attackerName = attacker.character_name ?? attacker.username;
  const phrase = (outcome) => combatPhrase({ category: 'weapon', outcome, attacker: attackerName, target: construction.name, weapon: weapon.display_name });

  logger.info(
    `[/attack construccion] ${interaction.user.tag} → "${construction.name}" @ (${x},${y}) con "${weapon.name}" ` +
    `(dist ${distance}, alcance ${rangeRoll}${inRange ? ` dentro, resultado ${outcomeRoll}` : ' fuera'}) → ` +
    `${hit ? `IMPACTO -${damage} vida${ruinedNow ? ' (EN RUINAS)' : ''}` : 'FALLO'}`
  );

  if (hit) {
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'tile.construction_attack', target: `(${x},${y})`,
      details: { constructionType: constructionType.name, weapon: weapon.name, damage, healthBefore, healthAfter, ruinedNow },
    });
  }

  const embed = new EmbedBuilder()
    .setColor(hit ? COLORS.RED : COLORS.GREY)
    .setTitle(hit ? `${weapon.emoji ?? '🔫'} ¡Impacto!` : `${weapon.emoji ?? '🔫'} Disparo fallido`)
    .addFields(
      { name: '🎯 Atacante',      value: `**${attacker.character_name ?? attacker.username}**`, inline: true },
      { name: '🏗️ Construcción',  value: `**${construction.name}** (${x}, ${y})`, inline: true },
      { name: '🔫 Arma',          value: `${weapon.emoji ?? '🔫'} ${weapon.display_name}`, inline: true },
      { name: '📏 Distancia',     value: `${distance} casilla${distance !== 1 ? 's' : ''}`, inline: true },
      { name: '🎲 Tirada de alcance', value: `${rangeRoll} / 6 → ${inRange ? '**dentro de alcance**' : '*fuera de alcance*'}`, inline: true }
    )
    .setTimestamp();

  if (ammoConsumed) {
    embed.addFields({ name: '🔹 Munición', value: `-${ammoConsumed.cost} (quedan: ${ammoConsumed.remaining})`, inline: true });
  }

  if (!inRange) {
    embed.setDescription(`${phrase('miss')}\n\nEl disparo no alcanzó a la construcción — la distancia no coincidía con esta tirada.`);
    const weaponThumb = buildAssetUrl(weapon.image_filename, '/attack');
    if (weaponThumb) embed.setThumbnail(weaponThumb);
    return interaction.reply({ embeds: [embed] });
  }

  embed.addFields({ name: '🎲 Tirada de resultado', value: outcomeLabel(outcomeRoll), inline: true });

  if (outcomeRoll === 1) {
    embed.setDescription(
      `${phrase('weaponBreak')}\n\n` +
      (weaponBroke
        ? `💥 **${weapon.display_name}** se ha roto por el uso — se ha perdido 1 unidad del inventario.`
        : `🔧 **${weapon.display_name}** se ha dañado un poco *(durabilidad: ${weaponDurabilityAfter})*.`)
    );
  } else if (outcomeRoll === 2) {
    embed.setDescription(`${phrase('miss')}\n\nEl disparo falló, sin más consecuencias.`);
  } else {
    embed.addFields(
      { name: '💥 Daño', value: `-${damage}`, inline: true },
      { name: '❤️ Vida restante', value: `${healthAfter}`, inline: true }
    );
    const hitPhrase = phrase(outcomeRoll === 6 ? 'crit' : 'hit');
    if (ruinedNow) {
      embed.setDescription(
        `${hitPhrase}\n\n🏚️ **${construction.name}** ha quedado **en ruinas** — deja de contar como construcción válida ` +
        `(para \`/craft\`, requisitos de recetas, etc.) y su generador de recursos (si tenía) se ha desactivado. ` +
        `Sigue en la casilla hasta que alguien la retire con \`/build destroy\` o \`/casilla clean\`.`
      );
    } else {
      embed.setDescription(hitPhrase);
    }
  }

  const weaponThumb = buildAssetUrl(weapon.image_filename, '/attack');
  if (weaponThumb) embed.setThumbnail(weaponThumb);

  if (hit) await appendTileDefenders(interaction, embed, x, y);

  return interaction.reply({ embeds: [embed] });
}

export async function executeNpcAttack(interaction) {
  const weaponName = interaction.options.getString('arma', true).toLowerCase().trim();

  const player = await getPlayerByDiscordId(interaction.user.id);
  if (!player) {
    return interaction.reply({ content: '❌ Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.', flags: MessageFlags.Ephemeral });
  }

  const x = interaction.options.getInteger('x');
  const y = interaction.options.getInteger('y');
  if ((x === null) !== (y === null)) {
    return interaction.reply({ content: '❌ Si das una coordenada, tienes que dar las dos (x e y) — o ninguna, para el NPC de tu propia casilla.', flags: MessageFlags.Ephemeral });
  }

  const targetX = x === null ? player.coord_x : x;
  const targetY = x === null ? player.coord_y : y;
  const npcsHere = await getNpcsAtTile(targetX, targetY);

  if (npcsHere.length === 0) {
    return interaction.reply({
      content: x === null
        ? '❌ No hay ningún NPC en tu casilla actual.'
        : `❌ No hay ningún NPC en (${x}, ${y}).`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const requestedNpcId = interaction.options.getInteger('id');

  if (requestedNpcId === null && npcsHere.length > 1) {
    return interaction.reply({
      content: `❌ Hay ${npcsHere.length} NPCs ahí — usa \`/attack\` (sin argumentos) para elegir a cuál atacar.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const npc = requestedNpcId === null ? npcsHere[0] : npcsHere.find(n => n.id === requestedNpcId);
  if (!npc) {
    return interaction.reply({
      content: `❌ Ese NPC ya no está en (${targetX}, ${targetY}) — puede que lo hayan matado mientras elegías.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  let result;
  try {
    result = await resolveAttackOnNpc(interaction.client, interaction.user.id, npc.id, weaponName);
  } catch (err) {
    return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  const {
    attacker, weapon, distance, rangeRoll, inRange, meleeOnly,
    outcomeRoll, hit, damage, npcHpAfter, npcDied, drops,
    weaponBroke, weaponDurabilityAfter, ammoConsumed, npcCounterattack,
  } = result;

  const attackerName = attacker.character_name ?? attacker.username;
  const phrase = (outcome) => combatPhrase({ category: 'weapon', outcome, attacker: attackerName, target: npc.type_display_name, weapon: weapon.display_name });
  const counterPhrase = (outcome) => combatPhrase({ category: 'unarmed', outcome, attacker: npc.type_display_name, target: attackerName });

  logger.info(
    `[/attack npc] ${interaction.user.tag} → "${npc.type_display_name}" #${npc.id} con "${weapon.name}" ` +
    `(distancia ${distance}${inRange ? `, resultado ${outcomeRoll}` : ', FUERA DE ALCANCE'}) → ` +
    `${!inRange ? 'NO LLEGA' : hit ? `IMPACTO -${damage} HP${npcDied ? ' (MUERTO)' : ''}` : 'FALLO'}` +
    `${npcCounterattack ? ` · contraataque: ${npcCounterattack.heal ? 'curó en vez de atacar' : !npcCounterattack.inRange ? 'no alcanza' : npcCounterattack.hit ? `-${npcCounterattack.damage} HP` : 'falla'}` : ''}`
  );

  if (hit) {
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'combat.npc_hit', target: `(${npc.coord_x},${npc.coord_y})`,
      details: { npcId: npc.id, npcType: npc.type_display_name, weapon: weapon.name, damage, npcHpAfter, npcDied, dropsCount: drops.length },
    });
  }
  if (npcCounterattack?.hit) {
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'combat.npc_counterattack_hit', target: interaction.user.id,
      details: {
        npcId: npc.id, npcType: npc.type_display_name,
        damage: npcCounterattack.damage, playerHpAfter: npcCounterattack.playerHpAfter,
        playerKilled: npcCounterattack.playerKilled, immortalitySaved: npcCounterattack.immortalitySaved,
      },
    });
  }

  const npcsLeftHere = await getNpcsAtTile(npc.coord_x, npc.coord_y);
  const keepFightingRow = npcsLeftHere.length > 0 && !npcCounterattack?.playerKilled
    ? [buildAttackMenuRow(interaction.user.id, 'Atacar otra vez')]
    : [];

  if (!inRange) {
    const outOfRange = new EmbedBuilder()
      .setColor(COLORS.GREY)
      .setTitle(`${npc.type_emoji ?? '👤'} Fuera de alcance`)
      .setDescription(
        meleeOnly
          ? `**${weapon.display_name}** es un arma de cuerpo a cuerpo y **${npc.type_display_name}** está a **${distance}** casillas.`
          : `El disparo se queda corto: **${npc.type_display_name}** está a **${distance}** casillas y la tirada de alcance (**${rangeRoll}**) no llega.`
      )
      .addFields(
        { name: '🎯 Atacante', value: `**${attacker.character_name ?? attacker.username}**`, inline: true },
        { name: '👤 NPC', value: `**${npc.type_display_name}** (${npc.coord_x}, ${npc.coord_y})`, inline: true },
        { name: '🔫 Arma', value: `${weapon.emoji ?? '🔫'} ${weapon.display_name}`, inline: true }
      )
      .setTimestamp();
    if (ammoConsumed) {
      outOfRange.addFields({ name: '🔹 Munición', value: `-${ammoConsumed.cost} (quedan: ${ammoConsumed.remaining})`, inline: true });
    }
    return interaction.reply({ embeds: [outOfRange], components: keepFightingRow });
  }

  const embed = new EmbedBuilder()
    .setColor(hit ? COLORS.RED : COLORS.GREY)
    .setTitle(hit ? `${npc.type_emoji ?? '👤'} ¡Impacto!` : `${npc.type_emoji ?? '👤'} Ataque fallido`)
    .addFields(
      { name: '🎯 Atacante', value: `**${attacker.character_name ?? attacker.username}**`,          inline: true },
      { name: '👤 NPC',      value: `**${npc.type_display_name}** (${npc.coord_x}, ${npc.coord_y})`, inline: true },
      { name: '🔫 Arma',     value: `${weapon.emoji ?? '🔫'} ${weapon.display_name}`,                inline: true },
      { name: '🎲 Tirada de resultado', value: outcomeLabel(outcomeRoll), inline: true }
    )
    .setTimestamp();

  if (ammoConsumed) {
    embed.addFields({ name: '🔹 Munición', value: `-${ammoConsumed.cost} (quedan: ${ammoConsumed.remaining})`, inline: true });
  }

  if (outcomeRoll === 1) {
    embed.setDescription(
      `${phrase('weaponBreak')}\n\n` +
      (weaponBroke
        ? `💥 **${weapon.display_name}** se ha roto por el uso — se ha perdido 1 unidad del inventario.`
        : `🔧 **${weapon.display_name}** se ha dañado un poco *(durabilidad: ${weaponDurabilityAfter})*.`)
    );
  } else if (outcomeRoll === 2) {
    embed.setDescription(`${phrase('miss')}\n\nEl ataque falla, sin más consecuencias.`);
  } else {
    embed.addFields(
      { name: '💥 Daño', value: `-${damage} HP`, inline: true },
      { name: '❤️ Vida del NPC', value: npcDied ? '💀 Muerto' : `${npcHpAfter}`, inline: true }
    );
    const hitPhrase = phrase(outcomeRoll === 6 ? 'crit' : 'hit');
    if (npcDied) {
      const dropLines = drops.map(d => `${d.emoji ?? '📦'} **${d.display_name}** ×${d.quantity}`);
      embed.setDescription(
        `${hitPhrase}\n\n💀 **${npc.type_display_name}** ha muerto.` +
        (dropLines.length > 0 ? `\n\n🎁 Botín tirado en la casilla:\n${dropLines.join('\n')}` : '\n\n*No ha soltado nada.*')
      );
    } else {
      embed.setDescription(hitPhrase);
    }
  }

  if (npcCounterattack) {
    const c = npcCounterattack;
    const counterDesc = c.heal
      ? `💊 En vez de contraatacar, **${npc.type_display_name}** usa **${c.heal.item.display_name}** en ${c.heal.isSelf ? 'sí mismo' : `**${c.heal.target.type_display_name}**`} (+${c.heal.healthAfter - c.heal.healthBefore} HP, ahora ${c.heal.healthAfter}).`
      : !c.inRange
      ? `${npc.type_emoji ?? '👤'} **${npc.type_display_name}** intenta responder, pero a **${c.distance}** casillas no te alcanza.`
      : !c.hit
      ? `${counterPhrase('miss')} — falla.`
      : c.playerKilled
        ? `${counterPhrase(c.outcomeRoll === 6 ? 'crit' : 'hit')} -${c.damage} HP. 💀 **${attackerName}** ha muerto por el contraataque. Staff tiene 7 días para revivirlo (o puede rendirse antes con \`/personaje rendirse\`).`
        : c.immortalitySaved
          ? `${counterPhrase(c.outcomeRoll === 6 ? 'crit' : 'hit')} -${c.damage} HP. ♾️ Salvado por inmortalidad (clampeado a 1 HP).`
          : `${counterPhrase(c.outcomeRoll === 6 ? 'crit' : 'hit')} -${c.damage} HP *(tu HP: ${c.playerHpAfter})*.`;
    embed.addFields({ name: c.heal ? '💊 Curación' : '⚔️ Contraataque', value: counterDesc });
  }

  const npcThumb = buildAssetUrl(npc.image_filename, '/attack');
  if (npcThumb) embed.setThumbnail(npcThumb);

  await interaction.reply({ embeds: [embed], components: keepFightingRow });

  if (npcDied) {
    await resolveEncounterIfConcluded(interaction.client, npc)
      .catch(err => logger.warn(`[/attack npc] No se pudo resolver el encuentro tras la muerte del NPC: ${err.message}`));
  }
}
