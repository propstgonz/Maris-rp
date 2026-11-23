import { SlashCommandBuilder } from 'discord.js';
import { replyWithView } from '../../components/playerViews.js';
import { transferProperty } from '../../components/transferFlow.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';
import { ownPropertyChoices } from '../../utils/autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('propiedades')
    .setDescription('Tus propiedades')
    .addSubcommand(sub => sub
      .setName('ver')
      .setDescription('Lista tus propiedades')
      .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver las de otro jugador').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('traspasar')
      .setDescription('Ofrece una propiedad a otro jugador (tiene que aceptar)')
      .addUserOption(opt => opt.setName('destinatario').setDescription('Quién la recibe').setRequired(true))
      .addIntegerOption(opt => opt.setName('propiedad').setDescription('Propiedad a traspasar').setRequired(true).setAutocomplete(true))),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'ver') return replyWithView(interaction, 'propiedades');
    const sender = await requireLivingCharacter(interaction.user.id);
    return transferProperty(
      interaction, sender,
      interaction.options.getUser('destinatario', true),
      interaction.options.getInteger('propiedad', true),
    );
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'propiedad') return interaction.respond([]);
    return interaction.respond(await ownPropertyChoices(interaction.user.id, focused.value));
  },
};
