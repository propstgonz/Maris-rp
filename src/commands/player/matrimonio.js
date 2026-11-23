import { SlashCommandBuilder } from 'discord.js';
import { startMarriage, startDivorce } from '../../components/perfilActions.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';

export default {
  data: new SlashCommandBuilder()
    .setName('matrimonio')
    .setDescription('Matrimonio de tu personaje')
    .addSubcommand(sub => sub
      .setName('proponer')
      .setDescription('Propón matrimonio a otro personaje')
      .addUserOption(opt => opt.setName('usuario').setDescription('Con quién').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('divorciar')
      .setDescription('Divórciate de tu cónyuge')),

  async execute(interaction) {
    const player = await requireLivingCharacter(interaction.user.id);
    if (interaction.options.getSubcommand() === 'divorciar') return startDivorce(interaction, player);
    return startMarriage(interaction, player, interaction.options.getUser('usuario', true));
  },
};
