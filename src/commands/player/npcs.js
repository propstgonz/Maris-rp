import { SlashCommandBuilder } from 'discord.js';
import { replyWithView } from '../../components/playerViews.js';
import { transferNpcs } from '../../components/transferFlow.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';
import { ownNpcNameChoices } from '../../utils/autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('npcs')
    .setDescription('Tus NPCs')
    .addSubcommand(sub => sub
      .setName('ver')
      .setDescription('Lista tus NPCs agrupados por nombre')
      .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver los de otro jugador').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('traspasar')
      .setDescription('Ofrece NPCs a otro jugador (tiene que aceptar)')
      .addUserOption(opt => opt.setName('destinatario').setDescription('Quién los recibe').setRequired(true))
      .addStringOption(opt => opt.setName('nombre').setDescription('Nombre del NPC').setRequired(true).setAutocomplete(true))
      .addIntegerOption(opt => opt.setName('cantidad').setDescription('Cuántos').setRequired(true).setMinValue(1).setMaxValue(50))),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'ver') return replyWithView(interaction, 'npcs');
    const sender = await requireLivingCharacter(interaction.user.id);
    return transferNpcs(
      interaction, sender,
      interaction.options.getUser('destinatario', true),
      interaction.options.getString('nombre', true),
      interaction.options.getInteger('cantidad', true),
    );
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'nombre') return interaction.respond([]);
    return interaction.respond(await ownNpcNameChoices(interaction.user.id, focused.value));
  },
};
