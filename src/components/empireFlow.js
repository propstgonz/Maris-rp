import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getEmpireSummary, collectAllProduction } from '../services/empireService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { COLORS } from '../utils/embeds.js';
import { logAction } from '../services/auditLogService.js';

export const EMPIRE_NS = 'imperio';

const ROLE_LABELS = { producer: 'Productor', soldier: 'Soldado' };

function describeConstruction(c) {
  const parts = [`📍 (${c.coord_x}, ${c.coord_y})`];
  if (c.ruined) {
    parts.push('🏚️ **en ruinas**');
  } else if (!c.hasProduction) {
    parts.push('*sin producción configurada*');
  } else if (c.fuelEmpty) {
    parts.push('⛽ **sin combustible** — parada');
  } else if (c.cyclesReady > 0) {
    parts.push(`✅ **listo** (${c.cyclesReady} ciclo${c.cyclesReady === 1 ? '' : 's'} de ${c.granted_item_display ?? c.type_display_name})`);
  } else {
    parts.push(`⏳ produciendo ${c.granted_item_emoji ?? ''} ${c.granted_item_display ?? ''}`.trim());
  }
  return `${c.type_emoji ?? '🏗️'} **${c.name}** — ${parts.join(' · ')}`;
}

function describeNpc(n) {
  const parts = [`📍 (${n.coord_x}, ${n.coord_y})`];
  parts.push(n.role ? ROLE_LABELS[n.role] : '*sin rol*');
  parts.push(n.hasTool ? `${n.tool_emoji ?? '🔧'} ${n.tool_display_name}` : '*sin herramienta*');
  if (n.role === 'producer' && n.cyclesReady > 0) {
    parts.push(`✅ **listo** (${n.cyclesReady} ciclo${n.cyclesReady === 1 ? '' : 's'})`);
  }
  if (n.consecutive_hungry_days > 0) {
    parts.push(`⚠️ ${n.consecutive_hungry_days} día${n.consecutive_hungry_days === 1 ? '' : 's'} sin comer`);
  }
  return `${n.type_emoji ?? '👤'} **${n.type_display_name}** (\`#${n.id}\`) — ${parts.join(' · ')}`;
}

export async function buildEmpireMessage(discordId) {
  const { player, laburo, constructions, npcs } = await getEmpireSummary(discordId);

  const embed = new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle(`🏛️ Imperio de ${player.character_name ?? player.username}`)
    .addFields({ name: '💪 Laburo', value: laburo.toFixed(2), inline: true })
    .setTimestamp();

  embed.addFields({
    name: `🏭 Construcciones (${constructions.length})`,
    value: constructions.length === 0
      ? '*Todavía no has construido nada — ver `/build place`.*'
      : constructions.map(describeConstruction).join('\n'),
  });

  embed.addFields({
    name: `👤 NPCs reclutados (${npcs.length})`,
    value: npcs.length === 0
      ? '*Todavía no has reclutado ningún NPC — ver `/build reclutar` en una oficina de reclutamiento.*'
      : npcs.map(describeNpc).join('\n'),
  });

  const anyReady = constructions.some(c => c.cyclesReady > 0) || npcs.some(n => n.cyclesReady > 0);
  const components = anyReady
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(buildCustomId({ ns: EMPIRE_NS, action: 'collect', owner: discordId }))
          .setLabel('Cobrar todo')
          .setEmoji('💰')
          .setStyle(ButtonStyle.Success)
      )]
    : [];

  return { embeds: [embed], components, flags: MessageFlags.Ephemeral };
}

export async function handleEmpireComponent(interaction, parsed) {
  const discordId = interaction.user.id;

  if (parsed.action === 'collect') {
    const collected = await collectAllProduction(discordId);
    if (collected.length > 0) {
      logAction({
        source: 'discord', actorDiscordId: discordId, actorUsername: interaction.user.tag,
        action: 'empire.collect', target: discordId, details: { lines: collected },
      });
    }
    const payload = await buildEmpireMessage(discordId);
    payload.embeds[0].setDescription(
      collected.length > 0 ? `✅ **Cobrado:**\n${collected.join('\n')}` : 'No había nada listo para cobrar.'
    );
    return interaction.update(payload);
  }

  throw new Error(`Acción desconocida en /imperio: "${parsed.action}".`);
}
