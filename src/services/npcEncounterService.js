import { query, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { COLORS } from '../utils/embeds.js';
import { buildAssetUrl } from '../utils/publicUrl.js';
import { getTile } from './mapService.js';
import { getTerrainTypeById } from './terrainTypeService.js';
import {
  spawnWildNpc, spawnWildNpcGroup, getNpcAtTile, getNpcById, resolveNpcDeath, removeNpc,
  getWildNpcsEncounteredBy, countBlockingEncounters, getBlockingEncounters,
  releaseEncounter, releaseGroupEncounter, releaseEncountersAwayFromPlayer,
} from './npcService.js';
import { listNpcTypes, getNpcTypeById, getTerrains as getNpcTypeTerrains, getZones as getNpcTypeZones } from './npcTypeService.js';
import { listNpcGroupTypes, getNpcGroupTypeById, getTerrains as getNpcGroupTerrains, getZones as getNpcGroupZones } from './npcGroupTypeService.js';
import { getZoneById } from './zoneService.js';
import { resolveSpawnChance } from '../utils/spawnFilter.js';
import { resolveNpcCounterattack } from './npcCombatService.js';
import { releaseEncounterPause } from './travelService.js';
import { findPlayerById, getPlayerByDiscordId } from './playerService.js';
import { logAction } from './auditLogService.js';
import { combatPhrase } from '../utils/combatNarrative.js';

const ATTACK_PREFIX = 'npc_encounter_attack:';
const FLEE_PREFIX    = 'npc_encounter_flee:';
const SURRENDER_PREFIX = 'npc_encounter_surrender:';
const TAME_PREFIX = 'npc_encounter_tame:';
const GROUP_ATTACK_PREFIX = 'npc_group_encounter_attack:';
const GROUP_FLEE_PREFIX    = 'npc_group_encounter_flee:';
const GROUP_SURRENDER_PREFIX = 'npc_group_encounter_surrender:';

const SQL = {
  getFaction: `SELECT display_name, emoji FROM ${T.factions} WHERE id = ?`,

  getIdleAlivePlayers: `
    SELECT * FROM ${T.players}
    WHERE travel_dest_x IS NULL AND is_alive = 1 AND character_created_at IS NOT NULL
  `,

  getPendingPlacedSoloIds: `
    SELECT id FROM ${T.npcs}
    WHERE is_wild = 1 AND encountered_by_player_id IS NOT NULL AND spawned_from_group_type_id IS NULL
      AND encounter_notified_at IS NULL
  `,
  getPendingPlacedGroups: `
    SELECT DISTINCT encountered_by_player_id AS player_id, spawned_from_group_type_id AS group_type_id
    FROM ${T.npcs}
    WHERE is_wild = 1 AND encountered_by_player_id IS NOT NULL AND spawned_from_group_type_id IS NOT NULL
      AND encounter_notified_at IS NULL
  `,
  pauseTravel: `
    UPDATE ${T.players} SET travel_paused_by_npc_id = ?
    WHERE id = ? AND travel_dest_x IS NOT NULL AND travel_paused_by_npc_id IS NULL
  `,
  saveEncounterMessages: `
    UPDATE ${T.npcs}
    SET encountered_channel_id = ?, encountered_channel_message_id = ?, encountered_dm_message_id = ?,
        encounter_notified_at = NOW()
    WHERE id = ?
  `,
};

export function isNpcEncounterButton(customId) {
  return customId.startsWith(ATTACK_PREFIX) || customId.startsWith(FLEE_PREFIX)
    || customId.startsWith(SURRENDER_PREFIX) || customId.startsWith(TAME_PREFIX);
}

export function isNpcGroupEncounterButton(customId) {
  return customId.startsWith(GROUP_ATTACK_PREFIX) || customId.startsWith(GROUP_FLEE_PREFIX) || customId.startsWith(GROUP_SURRENDER_PREFIX);
}

export async function rollEncounterForPlayer(player) {
  const tile = await getTile(player.coord_x, player.coord_y);
  if (!tile) return null;
  if (await getNpcAtTile(player.coord_x, player.coord_y)) return null;

  const [terrain, zone] = await Promise.all([
    getTerrainTypeById(tile.terrain_type_id),
    getZoneById(tile.zone_id),
  ]);
  const soloCandidates = (await listNpcTypes()).filter(t => t.spawn_chance_percent > 0);
  const groupCandidates = (await listNpcGroupTypes()).filter(g => g.spawn_chance_percent > 0);

  for (const npcType of soloCandidates) {
    const [terrainRows, zoneRows] = await Promise.all([
      getNpcTypeTerrains(npcType.id),
      getNpcTypeZones(npcType.id),
    ]);
    const chance = resolveSpawnChance(npcType.spawn_chance_percent, {
      terrainRows, zoneRows, terrainName: terrain?.name ?? null, zoneName: zone?.name ?? null,
    });
    if (chance === null) continue;

    if (Math.random() * 100 < chance) {
      const npc = await spawnWildNpc(player.coord_x, player.coord_y, npcType.id, player.id);
      if (!npc) return null;
      logger.info(`[NpcEncounter] "${npcType.display_name}" (${npcType.is_aggressive ? 'agresivo' : 'pasivo'}) salió al paso de ${player.username} @ (${player.coord_x},${player.coord_y})`);
      return { kind: 'solo', npc, npcType };
    }
  }

  for (const groupType of groupCandidates) {
    const [groupTerrainRows, groupZoneRows] = await Promise.all([
      getNpcGroupTerrains(groupType.id),
      getNpcGroupZones(groupType.id),
    ]);
    const groupChance = resolveSpawnChance(groupType.spawn_chance_percent, {
      terrainRows: groupTerrainRows, zoneRows: groupZoneRows,
      terrainName: terrain?.name ?? null, zoneName: zone?.name ?? null,
    });
    if (groupChance === null) continue;

    if (Math.random() * 100 < groupChance) {
      const npcs = await spawnWildNpcGroup(player.coord_x, player.coord_y, groupType.id, player.id);
      if (!npcs) return null;
      logger.info(`[NpcEncounter] Grupo "${groupType.display_name}" (${npcs.length}, ${groupType.is_aggressive ? 'agresivo' : 'pasivo'}) salió al paso de ${player.username} @ (${player.coord_x},${player.coord_y})`);
      return { kind: 'group', npcs, groupType };
    }
  }

  return null;
}

export async function previewEncountersAtTile(x, y) {
  const tile = await getTile(x, y);
  if (!tile) return [];

  const [terrain, zone] = await Promise.all([
    getTerrainTypeById(tile.terrain_type_id),
    getZoneById(tile.zone_id),
  ]);
  const soloCandidates = (await listNpcTypes()).filter(t => t.spawn_chance_percent > 0);
  const groupCandidates = (await listNpcGroupTypes()).filter(g => g.spawn_chance_percent > 0);
  const results = [];

  for (const npcType of soloCandidates) {
    const [terrainRows, zoneRows] = await Promise.all([
      getNpcTypeTerrains(npcType.id),
      getNpcTypeZones(npcType.id),
    ]);
    const chance = resolveSpawnChance(npcType.spawn_chance_percent, {
      terrainRows, zoneRows, terrainName: terrain?.name ?? null, zoneName: zone?.name ?? null,
    });
    if (chance === null) continue;
    results.push({ kind: 'solo', emoji: npcType.emoji, displayName: npcType.display_name, isAggressive: Boolean(npcType.is_aggressive), chancePercent: chance });
  }

  for (const groupType of groupCandidates) {
    const [groupTerrainRows, groupZoneRows] = await Promise.all([
      getNpcGroupTerrains(groupType.id),
      getNpcGroupZones(groupType.id),
    ]);
    const chance = resolveSpawnChance(groupType.spawn_chance_percent, {
      terrainRows: groupTerrainRows, zoneRows: groupZoneRows,
      terrainName: terrain?.name ?? null, zoneName: zone?.name ?? null,
    });
    if (chance === null) continue;
    results.push({ kind: 'group', emoji: groupType.emoji, displayName: groupType.display_name, isAggressive: Boolean(groupType.is_aggressive), chancePercent: chance });
  }

  return results.sort((a, b) => b.chancePercent - a.chancePercent);
}

export async function sendEncounterPopup(client, player, npc, npcType) {
  const embed = new EmbedBuilder()
    .setColor(npcType.is_aggressive ? COLORS.RED : COLORS.YELLOW)
    .setTitle(`${npcType.emoji ?? '👤'} ¡Un encuentro! ${npcType.display_name}`)
    .setDescription(
      npcType.is_aggressive
        ? `**${npcType.display_name}** te sale al paso en **(${npc.coord_x}, ${npc.coord_y})** y parece hostil — tu viaje se detiene aquí hasta que lo resuelvas: atácalo, intenta huir (${npcType.flee_chance_percent}% de éxito), o ríndete y entrégale algo de lo tuyo (${npcType.surrender_chance_percent}% de que te deje ir vivo).`
        : `Ves a **${npcType.display_name}** cerca, en (${npc.coord_x}, ${npc.coord_y}). No parece peligroso — si no haces nada tu viaje sigue solo, pero puedes atacarlo si quieres.`
    )
    .addFields({ name: '❤️ Vida', value: `${npc.current_hp}/${npcType.max_hp}`, inline: true })
    .setTimestamp();

  const [faction] = npcType.faction_id ? await query(SQL.getFaction, [npcType.faction_id]) : [];
  if (faction) embed.addFields({ name: '🏳️ Facción', value: `${faction.emoji ?? '🏳️'} ${faction.display_name}`, inline: true });

  const thumb = buildAssetUrl(npcType.image_filename, '/npc-encounter');
  if (thumb) embed.setThumbnail(thumb);

  const buttons = [
    new ButtonBuilder().setCustomId(`${ATTACK_PREFIX}${npc.id}`).setLabel('Atacar').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
  ];
  if (npcType.is_aggressive) {
    buttons.push(new ButtonBuilder().setCustomId(`${FLEE_PREFIX}${npc.id}`).setLabel('Huir').setStyle(ButtonStyle.Secondary).setEmoji('🏃'));
    buttons.push(new ButtonBuilder().setCustomId(`${SURRENDER_PREFIX}${npc.id}`).setLabel('Rendirse').setStyle(ButtonStyle.Secondary).setEmoji('🏳️'));
  } else if (npcType.is_tameable && npcType.tame_bait_item_id) {
    buttons.push(new ButtonBuilder().setCustomId(`${TAME_PREFIX}${npc.id}`).setLabel('Domesticar').setStyle(ButtonStyle.Success).setEmoji('🐾'));
  }
  const payload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };

  let dmMessage = null, channelMessage = null;

  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (user) dmMessage = await user.send(payload).catch(() => null);

  if (player.modmail_channel_id) {
    const channel = await client.channels.fetch(player.modmail_channel_id).catch(() => null);
    if (channel?.isTextBased()) channelMessage = await channel.send(payload).catch(() => null);
  }

  await execute(SQL.saveEncounterMessages, [player.modmail_channel_id ?? null, channelMessage?.id ?? null, dmMessage?.id ?? null, npc.id]);
  return Boolean(dmMessage || channelMessage);
}

export async function sendGroupEncounterPopup(client, player, npcs, groupType) {
  const embed = new EmbedBuilder()
    .setColor(groupType.is_aggressive ? COLORS.RED : COLORS.YELLOW)
    .setTitle(`${groupType.emoji ?? '👥'} ¡Un encuentro! ${groupType.display_name}`)
    .setDescription(
      groupType.is_aggressive
        ? `**${groupType.display_name}** (${npcs.length}) te sale al paso en **(${npcs[0].coord_x}, ${npcs[0].coord_y})** y parece hostil — tu viaje se detiene aquí hasta que lo resuelvas: atácalos con \`/attack\`, intenta huir del grupo entero (${groupType.flee_chance_percent}% de éxito), o ríndete y entrégales algo de lo tuyo (${groupType.surrender_chance_percent}% de que te dejen ir vivo).`
        : `Ves a **${groupType.display_name}** (${npcs.length}) cerca, en (${npcs[0].coord_x}, ${npcs[0].coord_y}). No parecen peligrosos — si no haces nada tu viaje sigue solo, pero puedes atacarlos con \`/attack\` si quieres.`
    )
    .addFields(npcs.slice(0, 24).map(n => ({
      name: `${n.type_emoji ?? '👤'} ${n.type_display_name}`,
      value: `❤️ ${n.current_hp}/${n.type_max_hp}` + (n.faction_display_name ? `\n${n.faction_emoji ?? '🏳️'} ${n.faction_display_name}` : ''),
      inline: true,
    })))
    .setTimestamp();
  if (npcs.length > 24) embed.addFields({ name: '…', value: `+${npcs.length - 24} más`, inline: true });

  const buttons = [
    new ButtonBuilder().setCustomId(`${GROUP_ATTACK_PREFIX}${groupType.id}`).setLabel('Atacar').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
  ];
  if (groupType.is_aggressive) {
    buttons.push(new ButtonBuilder().setCustomId(`${GROUP_FLEE_PREFIX}${groupType.id}`).setLabel('Huir').setStyle(ButtonStyle.Secondary).setEmoji('🏃'));
    buttons.push(new ButtonBuilder().setCustomId(`${GROUP_SURRENDER_PREFIX}${groupType.id}`).setLabel('Rendirse').setStyle(ButtonStyle.Secondary).setEmoji('🏳️'));
  }
  const payload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] };

  let dmMessage = null, channelMessage = null;

  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (user) dmMessage = await user.send(payload).catch(() => null);

  if (player.modmail_channel_id) {
    const channel = await client.channels.fetch(player.modmail_channel_id).catch(() => null);
    if (channel?.isTextBased()) channelMessage = await channel.send(payload).catch(() => null);
  }

  for (const npc of npcs) {
    await execute(SQL.saveEncounterMessages, [player.modmail_channel_id ?? null, channelMessage?.id ?? null, dmMessage?.id ?? null, npc.id]);
  }
  return Boolean(dmMessage || channelMessage);
}

async function _applyEncounterResult(client, player, encounter) {
  const shouldPause = player.travel_dest_x != null;

  if (encounter.kind === 'group') {
    const { npcs, groupType } = encounter;
    const delivered = client
      ? await sendGroupEncounterPopup(client, player, npcs, groupType).catch(err => {
          logger.warn(`[NpcEncounter] No se pudo enviar el popup de grupo a ${player.username}: ${err.message}`);
          return false;
        })
      : false;
    const paused = shouldPause && Boolean(groupType.is_aggressive) && delivered;
    if (paused) await execute(SQL.pauseTravel, [npcs[0].id, player.id]);
    return { discordId: player.discord_id, npcTypeName: groupType.name, aggressive: !!groupType.is_aggressive, paused };
  }

  const { npc, npcType } = encounter;
  const delivered = client
    ? await sendEncounterPopup(client, player, npc, npcType).catch(err => {
        logger.warn(`[NpcEncounter] No se pudo enviar el popup a ${player.username}: ${err.message}`);
        return false;
      })
    : false;
  const paused = shouldPause && Boolean(npcType.is_aggressive) && delivered;
  if (paused) await execute(SQL.pauseTravel, [npc.id, player.id]);
  return { discordId: player.discord_id, npcTypeName: npcType.name, aggressive: !!npcType.is_aggressive, paused };
}

export async function rollAndHandleEncounter(client, player) {
  const encounter = await rollEncounterForPlayer(player);
  if (!encounter) return null;
  return _applyEncounterResult(client, player, encounter);
}

export async function processIdleEncounterRolls(client) {
  const idlers = await query(SQL.getIdleAlivePlayers);
  const results = [];

  for (const player of idlers) {
    try {
      const encounter = await rollAndHandleEncounter(client, player);
      if (encounter) results.push(encounter);
    } catch (err) {
      logger.error(`[NpcEncounter] Error procesando la ronda pasiva de ${player.username}: ${err.message}`);
      console.error(err);
    }
  }

  return results;
}

export async function processPendingPlacedEncounters(client) {
  const results = [];

  for (const { id } of await query(SQL.getPendingPlacedSoloIds)) {
    try {
      const npc = await getNpcById(id);
      if (!npc) continue;
      const player = await findPlayerById(npc.encountered_by_player_id);
      if (!player) continue;
      const npcType = await getNpcTypeById(npc.npc_type_id);
      if (!npcType) continue;

      results.push(await _applyEncounterResult(client, player, { kind: 'solo', npc, npcType }));
    } catch (err) {
      logger.error(`[NpcEncounter] Error procesando el NPC colocado a mano #${id}: ${err.message}`);
      console.error(err);
    }
  }

  for (const { player_id, group_type_id } of await query(SQL.getPendingPlacedGroups)) {
    try {
      const npcs = await getWildNpcsEncounteredBy(player_id, group_type_id);
      if (npcs.length === 0) continue;
      const player = await findPlayerById(player_id);
      if (!player) continue;
      const groupType = await getNpcGroupTypeById(group_type_id);
      if (!groupType) continue;

      results.push(await _applyEncounterResult(client, player, { kind: 'group', npcs, groupType }));
    } catch (err) {
      logger.error(`[NpcEncounter] Error procesando el grupo colocado a mano (jugador #${player_id}): ${err.message}`);
      console.error(err);
    }
  }

  return results;
}

async function _closeSiblingEncounterMessage(client, npc, discordId, resolutionText, skipMessageId) {
  const payload = { content: resolutionText, embeds: [], components: [] };

  if (npc.encountered_channel_id && npc.encountered_channel_message_id && npc.encountered_channel_message_id !== skipMessageId) {
    const channel = await client.channels.fetch(npc.encountered_channel_id).catch(() => null);
    const msg = channel?.isTextBased() ? await channel.messages.fetch(npc.encountered_channel_message_id).catch(() => null) : null;
    if (msg) await msg.edit(payload).catch(() => {});
  }

  if (npc.encountered_dm_message_id && npc.encountered_dm_message_id !== skipMessageId) {
    const user = await client.users.fetch(discordId).catch(() => null);
    const dmChannel = user ? await user.createDM().catch(() => null) : null;
    const msg = dmChannel ? await dmChannel.messages.fetch(npc.encountered_dm_message_id).catch(() => null) : null;
    if (msg) await msg.edit(payload).catch(() => {});
  }
}

export async function resolveEncounterIfConcluded(client, npc, skipMessageId = null, { release = 'none' } = {}) {
  if (!npc?.is_wild || !npc.encountered_by_player_id) return;

  const player = await findPlayerById(npc.encountered_by_player_id);
  if (!player) return;

  const resumed = await withTransaction(async () => {
    if (release === 'group' && npc.spawned_from_group_type_id) {
      await releaseGroupEncounter(player.id, npc.spawned_from_group_type_id);
    } else if (release === 'solo') {
      await releaseEncounter(npc.id);
    }
    await releaseEncountersAwayFromPlayer(player.id);
    if (await countBlockingEncounters(player.id) > 0) return null;
    return releaseEncounterPause(player.discord_id);
  });

  if (resumed === null) return;

  if (client) {
    const text = resumed ? '✅ Encuentro resuelto — tu viaje ha continuado.' : '✅ Encuentro resuelto.';
    await _closeSiblingEncounterMessage(client, npc, player.discord_id, text, skipMessageId)
      .catch(err => logger.warn(`[NpcEncounter] No se pudo cerrar el mensaje gemelo del encuentro: ${err.message}`));
  }
}

export async function handleNpcEncounterButton(interaction) {
  const isFlee = interaction.customId.startsWith(FLEE_PREFIX);
  const isSurrender = interaction.customId.startsWith(SURRENDER_PREFIX);
  const isTame = interaction.customId.startsWith(TAME_PREFIX);
  const npcId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;

  const npc = await getNpcById(npcId);
  if (!npc) {
    return interaction.update({ content: '❌ Ese NPC ya no está — puede que alguien más lo resolviera antes.', embeds: [], components: [] });
  }

  const owner = await findPlayerById(npc.encountered_by_player_id);
  if (!owner) {
    return interaction.reply({
      content: '❌ Ese encuentro ya está resuelto.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (owner.discord_id !== discordId) {
    return interaction.reply({
      content: `❌ Este encuentro es de **${owner.character_name ?? owner.username}**, no tuyo.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (isFlee) {
    return _handleFleeButton(interaction, npc, discordId);
  }
  if (isSurrender) {
    return _handleSurrenderButton(interaction, npc, discordId);
  }
  if (isTame) {
    return _handleTameButton(interaction, npc, discordId);
  }

  const { buildAttackKindMessage } = await import('../components/attackFlow.js');
  return interaction.reply(await buildAttackKindMessage(discordId));
}

async function _handleSurrenderButton(interaction, npc, discordId) {
  const { pickSurrenderLoot } = await import('./surrenderService.js');
  const { giveItem } = await import('./npcInventoryService.js');
  const { getItemByName } = await import('./itemService.js');

  const loot = await pickSurrenderLoot(discordId, async item => {
    const itemRow = await getItemByName(item.name);
    if (!itemRow) throw new Error(`"${item.name}" ya no existe en el catálogo.`);
    await giveItem(npc.id, itemRow.id, item.quantity);
  });
  const lootLine = loot.length > 0
    ? `Entregas ${loot.map(i => `${i.emoji ?? '📦'} **${i.display_name}**`).join(', ')}.`
    : 'No llevas nada que merezca la pena entregar, pero te rindes igual.';

  const spared = Math.random() * 100 < (npc.surrender_chance_percent ?? 50);

  if (spared) {
    await interaction.update({
      content: `🏳️ Te rindes ante **${npc.type_display_name}**. ${lootLine} Te deja ir — tu viaje continúa.`,
      embeds: [], components: [],
    });
    await resolveEncounterIfConcluded(interaction.client, npc, interaction.message.id, { release: 'solo' });
    return;
  }

  const counter = await resolveNpcCounterattack(interaction.client, discordId, npc);
  if (counter?.hit) {
    logAction({
      source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
      action: 'combat.npc_counterattack_hit', target: discordId,
      details: {
        npcId: npc.id, npcType: npc.type_display_name, trigger: 'surrender_betrayed',
        damage: counter.damage, playerHpAfter: counter.playerHpAfter,
        playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
      },
    });
  }
  const lines = [`🏳️ Te rindes ante **${npc.type_display_name}**. ${lootLine}`, 'No respeta el trato y te ataca igualmente.'];
  if (counter?.hit) {
    lines.push(`-${counter.damage} HP${counter.playerKilled ? ' — has muerto.' : ''}.`);
  } else if (counter) {
    lines.push('El golpe falla.');
  }
  await interaction.update({ content: lines.join(' ') });
}

async function _handleTameButton(interaction, npc, discordId) {
  const { attemptTame } = await import('./tameService.js');
  const player = await findPlayerById(npc.encountered_by_player_id);

  let result;
  try {
    result = await attemptTame(discordId, npc);
  } catch (err) {
    return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }

  if (!result.success) {
    return interaction.update({
      content: `🐾 Le ofreces ${result.baitItem.emoji ?? '📦'} **${result.baitItem.display_name}** a **${npc.type_display_name}**, pero no se fía — el cebo se pierde. Puedes intentarlo otra vez.`,
    });
  }

  logAction({
    source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
    action: 'npc.tamed', target: `(${npc.coord_x},${npc.coord_y})`,
    details: { npcId: npc.id, npcType: npc.type_display_name, bait: result.baitItem.name },
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle('🐾 ¡Domesticado!')
    .setDescription(
      `**${player?.character_name ?? interaction.user.username}** gana la confianza de **${npc.type_display_name}** ` +
      `con ${result.baitItem.emoji ?? '📦'} **${result.baitItem.display_name}** — ahora es tuyo.`
    )
    .setTimestamp();
  const thumb = buildAssetUrl(npc.image_filename, '/npc-encounter');
  if (thumb) embed.setThumbnail(thumb);

  await interaction.update({ content: '', embeds: [embed], components: [] });
  await resolveEncounterIfConcluded(interaction.client, npc, interaction.message.id);
}

async function _handleFleeButton(interaction, npc, discordId) {
  const { getNpcTypeById } = await import('./npcTypeService.js');
  const npcType = await getNpcTypeById(npc.npc_type_id);
  const success = Math.random() * 100 < (npcType?.flee_chance_percent ?? 100);

  if (success) {
    const { removeNpc } = await import('./npcService.js');
    await removeNpc(npc.id);
    await interaction.update({ content: `🏃 Consigues escapar de **${npc.type_display_name}** — tu viaje continúa.`, embeds: [], components: [] });
    await resolveEncounterIfConcluded(interaction.client, npc, interaction.message.id);
    return;
  }

  const counter = await resolveNpcCounterattack(interaction.client, discordId, npc);
  if (counter?.hit) {
    logAction({
      source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
      action: 'combat.npc_counterattack_hit', target: discordId,
      details: {
        npcId: npc.id, npcType: npc.type_display_name, trigger: 'failed_flee',
        damage: counter.damage, playerHpAfter: counter.playerHpAfter,
        playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
      },
    });
  }
  const lines = [`🏃 Intentas huir de **${npc.type_display_name}**... no lo consigues.`];
  if (counter?.heal) {
    lines.push(`💊 El NPC se cura en vez de atacarte (+${counter.heal.healthAfter - counter.heal.healthBefore} HP).`);
  } else if (counter?.hit) {
    lines.push(`El NPC aprovecha: -${counter.damage} HP${counter.playerKilled ? ' — has muerto.' : ''}.`);
  } else if (counter) {
    lines.push('El NPC intenta golpearte, pero falla.');
  }
  lines.push('Sigues aquí — puedes volver a intentarlo.');

  await interaction.update({ content: lines.join(' ') });
}

export async function handleNpcGroupEncounterButton(interaction) {
  const isFlee = interaction.customId.startsWith(GROUP_FLEE_PREFIX);
  const groupTypeId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;

  const { getPlayerByDiscordId } = await import('./playerService.js');
  const player = await getPlayerByDiscordId(discordId);
  const members = player ? await getWildNpcsEncounteredBy(player.id, groupTypeId) : [];

  if (members.length === 0) {
    return interaction.update({ content: '❌ Ese encuentro de grupo ya no está — puede que ya lo resolvieras.', embeds: [], components: [] });
  }

  if (isFlee) {
    return _handleGroupFleeButton(interaction, members, groupTypeId, discordId);
  }
  if (interaction.customId.startsWith(GROUP_SURRENDER_PREFIX)) {
    return _handleGroupSurrenderButton(interaction, members, groupTypeId, discordId);
  }

  const { buildAttackKindMessage } = await import('../components/attackFlow.js');
  return interaction.reply(await buildAttackKindMessage(discordId));
}

export async function attemptGroupFlee(client, discordId, username, members, groupType, source = 'discord') {
  const label = groupType?.display_name ?? 'el grupo';
  const success = Math.random() * 100 < (groupType?.flee_chance_percent ?? 100);

  if (success) {
    for (const member of members) await removeNpc(member.id);
    return { success: true, label, lines: [`Consigues escapar de **${label}** — tu viaje continúa.`] };
  }

  const lines = [];
  for (const member of members) {
    const counter = await resolveNpcCounterattack(client, discordId, member);
    if (!counter) continue;
    if (counter.heal) {
      lines.push(`💊 **${member.type_display_name}** se cura en vez de atacar (+${counter.heal.healthAfter - counter.heal.healthBefore} HP).`);
      continue;
    }
    if (counter.hit) {
      logAction({
        source, actorDiscordId: discordId, actorUsername: username,
        action: 'combat.npc_counterattack_hit', target: discordId,
        details: {
          npcId: member.id, npcType: member.type_display_name, trigger: 'failed_flee',
          damage: counter.damage, playerHpAfter: counter.playerHpAfter,
          playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
        },
      });
      lines.push(`**${member.type_display_name}** aprovecha: -${counter.damage} HP${counter.playerKilled ? ' — has muerto.' : ''}.`);
      if (counter.playerKilled) break;
    }
  }
  return { success: false, label, lines };
}

export async function attemptFlee(client, discordId, username, source = 'discord') {
  const player = await getPlayerByDiscordId(discordId);
  if (!player) return { blocked: false, freed: false, success: null, label: null, lines: [] };

  const holding = await getBlockingEncounters(player.id);
  if (holding.length === 0) {
    const freed = player.travel_paused_by_npc_id != null && await releaseEncounterPause(discordId);
    return { blocked: false, freed, success: null, label: null, lines: [] };
  }

  const npc = await getNpcById(holding[0].id);
  if (!npc) {
    await releaseEncounterPause(discordId);
    return { blocked: false, freed: true, success: null, label: null, lines: [] };
  }

  if (npc.spawned_from_group_type_id) {
    const members = await getWildNpcsEncounteredBy(player.id, npc.spawned_from_group_type_id);
    if (members.length === 0) {
      return { blocked: true, freed: false, isGroup: true, success: null, label: null, lines: ['Ese encuentro de grupo ya no está — vuelve a revisar tu viaje.'] };
    }
    const groupType = await getNpcGroupTypeById(npc.spawned_from_group_type_id);
    const result = await attemptGroupFlee(client, discordId, username, members, groupType, source);
    if (result.success) await resolveEncounterIfConcluded(client, members[members.length - 1]);
    return { blocked: true, freed: result.success, isGroup: true, ...result };
  }

  const npcType = await getNpcTypeById(npc.npc_type_id);
  const fleeChance = npcType?.flee_chance_percent ?? 100;
  const success = Math.random() * 100 < fleeChance;

  logger.info(`[Flee] ${username} intentó huir de "${npc.type_display_name}" #${npc.id} (${fleeChance}% de éxito) → ${success ? 'ÉXITO' : 'FALLO'}`);

  if (success) {
    await removeNpc(npc.id);
    await resolveEncounterIfConcluded(client, npc);
    return { blocked: true, freed: true, isGroup: false, success: true, label: npc.type_display_name, lines: [`Consigues escapar de **${npc.type_display_name}** — tu viaje continúa.`] };
  }

  const counter = await resolveNpcCounterattack(client, discordId, npc);
  const lines = [];
  if (counter?.hit) {
    logAction({
      source, actorDiscordId: discordId, actorUsername: username,
      action: 'combat.npc_counterattack_hit', target: discordId,
      details: {
        npcId: npc.id, npcType: npc.type_display_name, trigger: 'failed_flee',
        damage: counter.damage, playerHpAfter: counter.playerHpAfter,
        playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
      },
    });
    const playerName = player.character_name ?? player.username;
    const hitPhrase = combatPhrase({ category: 'unarmed', outcome: counter.outcomeRoll === 6 ? 'crit' : 'hit', attacker: npc.type_display_name, target: playerName });
    lines.push(`${hitPhrase} -${counter.damage} HP${counter.playerKilled ? ' — has muerto.' : ''}.`);
  } else if (counter) {
    const playerName = player.character_name ?? player.username;
    lines.push(combatPhrase({ category: 'unarmed', outcome: 'miss', attacker: npc.type_display_name, target: playerName }));
  }
  return { blocked: true, freed: false, isGroup: false, success: false, label: npc.type_display_name, lines };
}

async function _handleGroupSurrenderButton(interaction, members, groupTypeId, discordId) {
  const groupType = await getNpcGroupTypeById(groupTypeId);
  const label = groupType?.display_name ?? 'el grupo';

  const { pickSurrenderLoot } = await import('./surrenderService.js');
  const { giveItem } = await import('./npcInventoryService.js');
  const { getItemByName } = await import('./itemService.js');

  const loot = await pickSurrenderLoot(discordId, async item => {
    const itemRow = await getItemByName(item.name);
    if (!itemRow) throw new Error(`"${item.name}" ya no existe en el catálogo.`);
    await giveItem(members[0].id, itemRow.id, item.quantity);
  });
  const lootLine = loot.length > 0
    ? `Entregas ${loot.map(i => `${i.emoji ?? '📦'} **${i.display_name}**`).join(', ')}.`
    : 'No llevas nada que merezca la pena entregar, pero te rindes igual.';

  const spared = Math.random() * 100 < (groupType?.surrender_chance_percent ?? 50);

  if (spared) {
    await interaction.update({
      content: `🏳️ Te rindes ante **${label}**. ${lootLine} Te dejan ir — tu viaje continúa.`,
      embeds: [], components: [],
    });
    await resolveEncounterIfConcluded(interaction.client, members[members.length - 1], interaction.message.id, { release: 'group' });
    return;
  }

  const lines = [`🏳️ Te rindes ante **${label}**. ${lootLine}`, 'No respetan el trato y atacan igualmente.'];
  for (const member of members) {
    const counter = await resolveNpcCounterattack(interaction.client, discordId, member);
    if (!counter) continue;
    if (counter.heal) continue;
    if (counter.hit) {
      logAction({
        source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
        action: 'combat.npc_counterattack_hit', target: discordId,
        details: {
          npcId: member.id, npcType: member.type_display_name, trigger: 'surrender_betrayed',
          damage: counter.damage, playerHpAfter: counter.playerHpAfter,
          playerKilled: counter.playerKilled, immortalitySaved: counter.immortalitySaved,
        },
      });
      lines.push(`**${member.type_display_name}**: -${counter.damage} HP${counter.playerKilled ? ' — has muerto.' : ''}.`);
      if (counter.playerKilled) break;
    }
  }
  await interaction.update({ content: lines.join(' ') });
}

async function _handleGroupFleeButton(interaction, members, groupTypeId, discordId) {
  const groupType = await getNpcGroupTypeById(groupTypeId);
  const { success, label, lines } = await attemptGroupFlee(interaction.client, discordId, interaction.user.tag, members, groupType);

  if (success) {
    await interaction.update({ content: `🏃 ${lines[0]}`, embeds: [], components: [] });
    await resolveEncounterIfConcluded(interaction.client, members[members.length - 1], interaction.message.id);
    return;
  }

  const text = [`🏃 Intentas huir de **${label}**... no lo consigues.`, ...lines, 'Sigues aquí — puedes volver a intentarlo.'];
  await interaction.update({ content: text.join(' ') });
}
