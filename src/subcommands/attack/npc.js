import { EmbedBuilder, MessageFlags } from 'discord.js';
import { attemptFlee } from '../../services/npcEncounterService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';

export default {
  build: (sub) => sub
    .setName("huir")
    .setDescription("Intenta huir del NPC agresivo que tiene pausado tu viaje"),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const result = await attemptFlee(interaction.client, interaction.user.id, interaction.user.tag, 'discord');

    if (!result.blocked) {
      return interaction.reply({
        content: result.freed
          ? '✅ Lo que te retenía ya no está aquí — tu viaje continúa.'
          : '❌ No hay ningún encuentro reteniéndote ahora mismo.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (result.success === null) {
      return interaction.reply({
        content: `❌ ${result.lines[0]}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (result.success) {
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.GREEN)
            .setTitle('🏃 ¡Escapaste!')
            .setDescription(result.lines[0]),
        ],
      });
    }

    const retryHint = result.isGroup
      ? 'Sigue ahí — puedes volver a intentarlo con `/huir`, o atacarlo con `/attack` (elige el objetivo entre los del grupo).'
      : 'Sigue ahí — puedes volver a intentarlo con `/huir`, o atacarlo con `/attack`.';

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.YELLOW)
          .setTitle('🏃 Huida fallida')
          .setDescription([`Intentas huir de **${result.label}**... no lo consigues.`, ...result.lines, retryHint].join(' ')),
      ],
    });
  },
};
