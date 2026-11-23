import { SlashCommandBuilder } from 'discord.js';
import { replyWithView } from '../../components/playerViews.js';
import { listSchools } from '../../services/magicService.js';
import { UserFacingError } from '../../utils/errors.js';
import { schoolChoices } from '../../utils/autocomplete.js';

export default {
  data: new SlashCommandBuilder()
    .setName('conjuros')
    .setDescription('Tus conjuros desbloqueados')
    .addStringOption(opt => opt.setName('escuela').setDescription('Filtrar por escuela').setRequired(false).setAutocomplete(true))
    .addUserOption(opt => opt.setName('jugador').setDescription('[Rolepriest] Ver los de otro jugador').setRequired(false)),

  async execute(interaction) {
    const school = interaction.options.getString('escuela');
    if (school && !(await listSchools()).some(s => s.slug === school)) {
      throw new UserFacingError('Esa escuela no existe o está excluida hasta nuevo aviso.');
    }
    return replyWithView(interaction, 'conjuros', { school });
  },

  async autocomplete(interaction) {
    return interaction.respond(await schoolChoices(interaction.options.getFocused()));
  },
};
