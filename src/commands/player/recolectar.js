import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { attemptGather } from '../../services/resourceGatherService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { handleGatherableItemAutocomplete } from '../../utils/autocomplete.js';
import { COLORS } from '../../utils/embeds.js';
import logger from '../../utils/logger.js';
import { logAction } from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('recolectar')
    .setDescription('Intenta recolectar un recurso del terreno donde estás')
    .addStringOption(opt => opt.setName('item').setDescription('Qué intentas conseguir').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    await handleGatherableItemAutocomplete(interaction);
  },

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;
    const item = interaction.options.getString('item', true).toLowerCase().trim();

    let result;
    try {
      result = await attemptGather(interaction.user.id, item);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(
      `[/recolectar] ${interaction.user.tag} en (${result.x},${result.y}), buscando "${item}": ` +
      `${result.hit ? `${result.grantedQuantity}× ${result.grantedItemName}${result.wasTarget ? '' : ' (otra cosa)'}` : 'nada'}`
    );
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'gather.attempt', target: `(${result.x},${result.y})`,
      details: { targetItem: item, hit: result.hit, grantedItemName: result.grantedItemName, wasTarget: result.wasTarget },
    });

    const embed = new EmbedBuilder().setTimestamp();

    if (result.hit && result.wasTarget) {
      embed.setColor(COLORS.GREEN)
        .setTitle('✅ ¡Lo conseguiste!')
        .setDescription(`Consigues **${result.grantedQuantity}× ${result.grantedItemDisplay}** ${result.grantedItemEmoji ?? ''} en **${result.terrainDisplayName}**.`);
    } else if (result.hit) {
      embed.setColor(COLORS.GREEN)
        .setTitle('🍀 Encuentras otra cosa')
        .setDescription(`Buscabas algo distinto, pero encuentras **${result.grantedQuantity}× ${result.grantedItemDisplay}** ${result.grantedItemEmoji ?? ''} en **${result.terrainDisplayName}**.`);
    } else {
      embed.setColor(COLORS.GREY)
        .setTitle('Sin suerte esta vez')
        .setDescription(`No encuentras nada aprovechable en **${result.terrainDisplayName}** esta vez.`);
    }

    return interaction.reply({ embeds: [embed] });
  },
};
