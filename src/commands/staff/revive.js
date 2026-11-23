import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { reviveCharacter, reviveByCharacterId } from '../../services/characterLifecycleService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { actorFrom, rejectSelfTarget } from '../../utils/interactionContext.js';
import { findPlayerById } from '../../services/playerService.js';
import { COLORS }       from '../../utils/embeds.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import logger             from '../../utils/logger.js';

function buildRevivedEmbed(revived, staffTag, note = null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle('✨ Personaje revivido')
    .addFields({ name: '👤 Jugador', value: `<@${revived.discord_id}>`, inline: true })
    .setFooter({ text: `Revivido por ${staffTag}` })
    .setTimestamp();

  if (note) embed.setDescription(note);

  const avatarUrl = getAvatarUrl(revived, '/revive');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return embed;
}

export default {
  data: new SlashCommandBuilder()
    .setName('revive')
    .setDescription('[Staff] Revive a un personaje muerto')
    .addSubcommand(sub =>
      sub
        .setName('jugador')
        .setDescription('Revive mencionando al usuario de Discord')
        .addUserOption(opt =>
          opt.setName('jugador').setDescription('Jugador a revivir').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('personaje_id')
        .setDescription('Revive por el ID interno del personaje (dentro de la ventana de gracia de 7 días)')
        .addIntegerOption(opt =>
          opt.setName('id').setDescription('ID del personaje').setRequired(true).setMinValue(1)
        )
    ),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const sub = interaction.options.getSubcommand();
    const actor = actorFrom(interaction);

    if (sub === 'jugador') {
      const targetUser = interaction.options.getUser('jugador', true);
      rejectSelfTarget(interaction, targetUser.id);

      let revived;
      try {
        revived = await reviveCharacter(targetUser.id, actor);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      logger.info(`[/revive jugador] ${interaction.user.tag} → ${targetUser.tag} revivido`);

      return interaction.reply({ embeds: [buildRevivedEmbed(revived, interaction.user.tag)] });
    }

    const personajeId = interaction.options.getInteger('id', true);
    const target = await findPlayerById(personajeId);
    if (target) rejectSelfTarget(interaction, target.discord_id);

    let revived;
    try {
      revived = await reviveByCharacterId(personajeId, actor);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/revive personaje_id] ${interaction.user.tag} → ID ${personajeId} (${revived.character_name}) revivido`);

    return interaction.reply({
      embeds: [buildRevivedEmbed(revived, interaction.user.tag, 'Revivido dentro de la ventana de gracia de 7 días.')],
    });
  },
};
