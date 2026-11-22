import { EmbedBuilder, MessageFlags } from 'discord.js';
import { updateCharacterIdentity } from '../../services/characterLifecycleService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { genderLabel, GENDER_CHOICES } from '../../utils/text.js';

export default {
  build: (sub) => sub
    .setName('genero')
    .setDescription('Fija o cambia el género de tu personaje')
    .addStringOption(opt =>
      opt
        .setName('valor')
        .setDescription('Género de tu personaje')
        .setRequired(true)
        .addChoices(...GENDER_CHOICES)
    ),

  async execute(interaction) {
    if (!await requireCharacter(interaction)) return;

    const genero = interaction.options.getString('valor', true);
    const player = await updateCharacterIdentity(interaction.user.id, { gender: genero });

    const embed = new EmbedBuilder()
      .setColor(COLORS.GREEN)
      .setTitle('✅ Género actualizado')
      .setDescription(`El género de **${player.character_name}** ahora es **${genderLabel(genero)}**.`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
