import { SlashCommandBuilder } from 'discord.js';
import { replyWithView } from '../../components/playerViews.js';
import { transferGoods } from '../../components/transferFlow.js';
import { requireLivingCharacter } from '../../utils/interactionContext.js';
import { ownGoodsChoices } from '../../utils/autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bienes')
    .setDescription('Tus bienes')
    .addSubcommand(sub => sub
      .setName('ver')
      .setDescription('Lista tus bienes por categoría')
      .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver los de otro jugador').setRequired(false)))
    .addSubcommand(sub => sub
      .setName('traspasar')
      .setDescription('Ofrece bienes a otro jugador (tiene que aceptar)')
      .addUserOption(opt => opt.setName('destinatario').setDescription('Quién los recibe').setRequired(true))
      .addIntegerOption(opt => opt.setName('objeto').setDescription('Bien a traspasar').setRequired(true).setAutocomplete(true))
      .addNumberOption(opt => opt.setName('cantidad').setDescription('Cantidad (hasta 2 decimales)').setRequired(true).setMinValue(0.01))),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'ver') return replyWithView(interaction, 'bienes');
    const sender = await requireLivingCharacter(interaction.user.id);
    return transferGoods(
      interaction, sender,
      interaction.options.getUser('destinatario', true),
      interaction.options.getInteger('objeto', true),
      interaction.options.getNumber('cantidad', true),
    );
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'objeto') return interaction.respond([]);
    return interaction.respond(await ownGoodsChoices(interaction.user.id, focused.value));
  },
};
