import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { listPendingForPlayer } from '../../services/consentService.js';
import { buildRequestListView } from '../../components/consentFlow.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';

export default {
  data: new SlashCommandBuilder()
    .setName('solicitudes')
    .setDescription('Tus solicitudes pendientes: traspasos y propuestas'),

  async execute(interaction) {
    const player = await requireLivingCharacter(interaction.user.id);
    const pending = await listPendingForPlayer(player.id);
    return interaction.reply({ ...buildRequestListView(interaction.user.id, pending), flags: MessageFlags.Ephemeral });
  },
};
