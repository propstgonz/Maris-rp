import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { getNpcsAtTile } from '../../services/npcService.js';
import { attemptTame } from '../../services/tameService.js';
import { resolveEncounterIfConcluded } from '../../services/npcEncounterService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('domesticar')
    .setDescription('Intenta domesticar un NPC amistoso de tu casilla — necesitas su cebo')
    .addIntegerOption(opt =>
      opt
        .setName('npc_id')
        .setDescription('Cuál, si hay varios NPCs en tu casilla (te lo dirá si hace falta)')
        .setRequired(false)
        .setMinValue(1)
    ),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const player = await getPlayerByDiscordId(interaction.user.id);
    const npcId = interaction.options.getInteger('npc_id');

    const npcsHere = (await getNpcsAtTile(player.coord_x, player.coord_y))
      .filter(n => n.owner_player_id == null);
    if (npcsHere.length === 0) {
      return interaction.reply({ content: '❌ No hay ningún NPC sin dueño en tu casilla.', flags: MessageFlags.Ephemeral });
    }

    let npc;
    if (npcsHere.length === 1) {
      npc = npcsHere[0];
    } else if (npcId) {
      npc = npcsHere.find(n => n.id === npcId);
      if (!npc) {
        return interaction.reply({
          content: `❌ Ninguno de los NPCs de tu casilla tiene id ${npcId}. IDs disponibles: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      return interaction.reply({
        content: `❌ Hay ${npcsHere.length} NPCs en tu casilla — indica \`npc_id\` para elegir a cuál domesticar. IDs: ${npcsHere.map(n => `${n.id} (${n.type_display_name})`).join(', ')}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const playerName = player.character_name ?? player.username;

    let result;
    try {
      result = await attemptTame(interaction.user.id, npc);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/domesticar] ${interaction.user.tag} intentó domesticar a "${npc.type_display_name}" #${npc.id} → ${result.success ? 'ÉXITO' : 'FALLO'}`);

    if (result.success) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'npc.tamed', target: `(${npc.coord_x},${npc.coord_y})`,
        details: { npcId: npc.id, npcType: npc.type_display_name, bait: result.baitItem.name },
      });

      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('🐾 ¡Domesticado!')
        .setDescription(`**${playerName}** gana la confianza de **${npc.type_display_name}** con ${result.baitItem.emoji ?? '📦'} **${result.baitItem.display_name}** — ahora es tuyo.`)
        .setTimestamp();
      const npcThumb = buildAssetUrl(npc.image_filename, '/domesticar');
      if (npcThumb) embed.setThumbnail(npcThumb);

      await interaction.reply({ embeds: [embed] });
      return resolveEncounterIfConcluded(interaction.client, npc);
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.YELLOW)
      .setTitle('🐾 No confía en ti todavía')
      .setDescription(`**${playerName}** le ofrece ${result.baitItem.emoji ?? '📦'} **${result.baitItem.display_name}** a **${npc.type_display_name}**, pero no consigue domesticarlo — el cebo se pierde. Puedes intentarlo de nuevo.`)
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
