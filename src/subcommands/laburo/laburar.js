import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { performLaburar } from '../../services/laburoService.js';
import { requireRolepriest, requireCharacter } from '../../utils/permissions.js';
import { COLORS, formatExpiry } from '../../utils/embeds.js';
import { getAvatarUrl }  from '../../utils/playerAvatar.js';
import { logAction }     from '../../services/auditLogService.js';
import logger             from '../../utils/logger.js';

export default {
  build: (sub) => sub
    .setName("trabajar")
    .setDescription("Trabaja para ganar Laburo (una vez cada 23h)")
    .addUserOption(opt =>
      opt
        .setName('jugador')
        .setDescription('[Staff] Jugador que labura (por defecto: tú mismo)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('jugador') ?? interaction.user;
    const isSelf      = targetUser.id === interaction.user.id;

    if (isSelf) {
      if (!await requireCharacter(interaction)) return;
    } else {
      if (!await requireRolepriest(interaction)) return;
      if (!(await getPlayerByDiscordId(targetUser.id))?.character_created_at) {
        return interaction.reply({
          content: `❌ **${targetUser.username}** todavía no ha creado un personaje.`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    const player = await getPlayerByDiscordId(targetUser.id);

    let earned;
    try {
      earned = await performLaburar(targetUser.id);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(
      `[/laburar] ${interaction.user.tag} → ${targetUser.tag}: +${earned.amount} Laburo ` +
      `(${earned.modifierSum >= 0 ? '+' : ''}${earned.modifierSum} efectos), caduca ${earned.expiresAt}`
    );

    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'laburo.earn', target: targetUser.id,
      details: { amount: earned.amount, modifierSum: earned.modifierSum, expiresAt: earned.expiresAt },
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.GREEN)
      .setTitle('⚒️ ¡A trabajar!')
      .setDescription(`**${player.character_name ?? player.username}** ha ganado **+${earned.amount}** de Laburo.`)
      .addFields(
        { name: '👤 Jugador',          value: `<@${targetUser.id}>`, inline: true },
        { name: '💪 Laburo disponible', value: `${earned.totalAvailable}`, inline: true },
        { name: '⏳ Este lote caduca',  value: formatExpiry(earned.expiresAt), inline: true }
      )
      .setFooter({ text: 'Vuelve en 23h para laburar de nuevo' })
      .setTimestamp();

    if (earned.appliedEffects.length > 0) {
      embed.addFields({
        name:  '🎭 Efectos aplicados',
        value: earned.appliedEffects
          .map(e => `${e.emoji} **${e.label}**: ${e.laburo_modifier > 0 ? '+' : ''}${e.laburo_modifier}`)
          .join('\n'),
      });
    }

    const avatarUrl = getAvatarUrl(player, '/laburo trabajar');
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return interaction.reply({ embeds: [embed] });
  },
};
