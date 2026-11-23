import { SlashCommandBuilder } from 'discord.js';
import { replyWithView } from '../../components/playerViews.js';
import { startFreeSchool } from '../../components/perfilActions.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';
import { schoolChoices } from '../../utils/autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('escuelas')
    .setDescription('Tus escuelas de magia')
    .addSubcommand(sub => sub
      .setName('ver')
      .setDescription('Nivel, siguiente meta y Magia total')
      .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver las de otro jugador').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('iniciar')
      .setDescription('Usa tu escuela gratuita (Autismo efectivo 6 o más)')
      .addStringOption(opt => opt.setName('escuela').setDescription('Escuela a iniciar').setRequired(true).setAutocomplete(true))),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'ver') return replyWithView(interaction, 'escuelas');
    const player = await requireLivingCharacter(interaction.user.id);
    return startFreeSchool(interaction, player, interaction.options.getString('escuela', true));
  },

  async autocomplete(interaction) {
    return interaction.respond(await schoolChoices(interaction.options.getFocused()));
  },
};
