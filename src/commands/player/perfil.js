import { SlashCommandBuilder } from 'discord.js';
import { replyWithView } from '../../components/playerViews.js';

export default {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Tu personaje: estadísticas, inventarios, escuelas y conjuros')
    .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver el perfil de otro jugador').setRequired(false)),

  async execute(interaction) {
    return replyWithView(interaction, 'perfil');
  },
};
