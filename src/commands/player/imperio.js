import { SlashCommandBuilder } from 'discord.js';
import { requireCharacter } from '../../utils/permissions.js';
import { buildEmpireMessage } from '../../components/empireFlow.js';

export default {
  data: new SlashCommandBuilder()
    .setName('imperio')
    .setDescription('Consulta todas tus construcciones y NPCs reclutados, y cobra su producción pendiente'),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;
    return interaction.reply(await buildEmpireMessage(interaction.user.id));
  },
};
