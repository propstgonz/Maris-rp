

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { markDeceased } from '../../services/characterLifecycleService.js';
import { actorFrom, rejectSelfTarget } from '../../utils/interactionContext.js';
import { requireRolepriest, resolveGuild, config } from '../../utils/permissions.js';
import { COLORS }       from '../../utils/embeds.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import logger            from '../../utils/logger.js';

const ANNOUNCE_CH = config.channels?.announcements;

export default {
  data: new SlashCommandBuilder()
    .setName('kill')
    .setDescription('[Staff] PERMADEATH: mata a un jugador de inmediato, sin posibilidad de revivir')
    .addUserOption(opt =>
      opt.setName('jugador').setDescription('Jugador a eliminar').setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('motivo')
        .setDescription('Motivo narrativo de la muerte (se le notifica al jugador por MD)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const targetUser = interaction.options.getUser('jugador', true);
    rejectSelfTarget(interaction, targetUser.id);
    const motivo      = interaction.options.getString('motivo') ?? 'eliminado por Staff';

    const actor = actorFrom(interaction);

    let player;
    try {
      player = await markDeceased(interaction.client, targetUser.id, motivo, { permadeath: true, actor });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    const { fromGrace } = player;

    logger.info(`[/kill] ${interaction.user.tag} → ${targetUser.tag} PERMADEATH${fromGrace ? ' (finalizado desde periodo de gracia)' : ''} (motivo: ${motivo})`);

    const embed = new EmbedBuilder()
      .setColor(COLORS.BLACK)
      .setTitle('💀 Jugador eliminado — PERMADEATH')
      .addFields(
        { name: 'Jugador', value: `<@${targetUser.id}>`, inline: true },
        { name: 'Motivo',  value: fromGrace ? `Finalizado por un Rolepriest (ya estaba en periodo de gracia — ${motivo})` : motivo, inline: true }
      )
      .setDescription(
        (fromGrace
          ? 'El personaje seguía en periodo de gracia (7 días): un Rolepriest ha adelantado su muerte definitiva. '
          : 'Sin ventana de gracia: ') +
        'inventarios, matrimonio e identidad ya se han borrado. **No hay forma de revivirlo.** ' +
        'El jugador podrá crear otro personaje cuando termine la espera de creación, contada desde esta muerte.'
      )
      .setFooter({ text: `Eliminado por ${interaction.user.tag}` })
      .setTimestamp();

    const avatarUrl = getAvatarUrl(player, '/kill');
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    if (ANNOUNCE_CH) {
      const guild   = resolveGuild(interaction);
      const channel = await guild?.channels.fetch(ANNOUNCE_CH).catch(() => null);
      if (channel?.isTextBased() && channel.id !== interaction.channelId) {
        await channel
          .send(`💀 **${player.character_name ?? player.username}** ha sido eliminado por Staff (permadeath).`)
          .catch(err => logger.warn(`[/kill] No se pudo anunciar en el canal de announcements: ${err.message}`));
      }
    }

    return interaction.reply({ embeds: [embed] });
  },
};
