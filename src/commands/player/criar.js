import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getNpcById } from '../../services/npcService.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { attemptBreed } from '../../services/breedingService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('criar')
    .setDescription('Intenta que dos animales tuyos del mismo tipo tengan una cría')
    .addIntegerOption(opt => opt.setName('padre').setDescription('ID del primer animal (ver /montura o /imperio)').setRequired(true).setMinValue(1))
    .addIntegerOption(opt => opt.setName('madre').setDescription('ID del segundo animal').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const idA = interaction.options.getInteger('padre', true);
    const idB = interaction.options.getInteger('madre', true);

    const [player, npcA, npcB] = await Promise.all([
      getPlayerByDiscordId(interaction.user.id), getNpcById(idA), getNpcById(idB),
    ]);
    if (!npcA) return interaction.reply({ content: `❌ No existe ningún NPC con ID ${idA}.`, flags: MessageFlags.Ephemeral });
    if (!npcB) return interaction.reply({ content: `❌ No existe ningún NPC con ID ${idB}.`, flags: MessageFlags.Ephemeral });

    let result;
    try {
      result = await attemptBreed(player, npcA, npcB);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/criar] ${interaction.user.tag}: "${npcA.type_display_name}" #${npcA.id} × #${npcB.id} → ${result.success ? `ÉXITO (cría #${result.offspring.id})` : 'FALLO'}`);

    if (!result.success) {
      logAction({
        source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
        action: 'npc.breed_failed', target: `(${npcA.coord_x},${npcA.coord_y})`,
        details: { parentAId: npcA.id, parentBId: npcB.id, npcType: npcA.type_display_name },
      });
      return interaction.reply({
        content: `💔 **${npcA.type_display_name}** #${npcA.id} y #${npcB.id} no consiguen tener cría esta vez. Ambos necesitan descansar antes de volver a intentarlo.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'npc.bred', target: `(${npcA.coord_x},${npcA.coord_y})`,
      details: { parentAId: npcA.id, parentBId: npcB.id, offspringId: result.offspring.id, npcType: npcA.type_display_name },
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.GREEN)
      .setTitle(`🐣 ¡Nueva cría de ${npcA.type_display_name}!`)
      .setDescription(`**${npcA.type_display_name}** #${npcA.id} y #${npcB.id} tienen una cría — NPC #${result.offspring.id}, ya tuyo, en (${npcA.coord_x}, ${npcA.coord_y}).`)
      .setTimestamp();
    const thumb = buildAssetUrl(npcA.image_filename, '/criar');
    if (thumb) embed.setThumbnail(thumb);
    return interaction.reply({ embeds: [embed] });
  },
};
