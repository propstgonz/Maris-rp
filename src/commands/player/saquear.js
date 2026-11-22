import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { proposeRobbery, markRobberyMessage } from '../../services/robberyService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('saquear')
    .setDescription('Exige a otro jugador de tu casilla que te entregue algo — pelear o rendirse, elige él')
    .addUserOption(opt => opt.setName('jugador').setDescription('Jugador a saquear').setRequired(true)),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const targetUser = interaction.options.getUser('jugador', true);

    let proposal;
    try {
      proposal = await proposeRobbery(interaction.user.id, targetUser.id, interaction.channelId);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/saquear] ${interaction.user.tag} propuso saquear a ${targetUser.tag} (propuesta #${proposal.id})`);
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'player.robbery_proposed', target: targetUser.id,
      details: { robberyId: proposal.id, targetName: targetUser.username },
    });

    await interaction.reply(proposal.payload);
    const message = await interaction.fetchReply().catch(() => null);
    if (message?.id) await markRobberyMessage(proposal.id, message.id);
  },
};
