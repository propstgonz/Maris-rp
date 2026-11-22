


















import { SlashCommandBuilder } from 'discord.js';
import { requireCharacter } from '../../utils/permissions.js';
import { buildHubMessage } from '../../components/hubFlow.js';

export default {
  data: new SlashCommandBuilder()
    .setName('jugar')
    .setDescription('Abre el menú de juego: inventario, fabricar, construir, combate, mapa y tu personaje'),


  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;


    return interaction.reply(await buildHubMessage(interaction.user.id));
  },
};
