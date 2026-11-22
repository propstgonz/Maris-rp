

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { markDeceased, finalizeGraceDeath } from '../../services/characterLifecycleService.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { requireRolepriest, resolveGuild, config } from '../../utils/permissions.js';
import { COLORS }       from '../../utils/embeds.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import logger            from '../../utils/logger.js';
import { logAction }    from '../../services/auditLogService.js';

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
    const motivo      = interaction.options.getString('motivo') ?? 'eliminado por Staff';

    const existing = await getPlayerByDiscordId(targetUser.id);
    const wasInGrace = Boolean(existing?.character_created_at && !existing.is_alive);

    let player;
    try {
      player = wasInGrace
        ? await finalizeGraceDeath(targetUser.id, interaction.client)
        : await markDeceased(interaction.client, targetUser.id, motivo, { permadeath: true });
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/kill] ${interaction.user.tag} → ${targetUser.tag} PERMADEATH${wasInGrace ? ' (finalizado desde periodo de gracia)' : ''} (motivo: ${motivo})`);
    logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'player.kill', target: targetUser.id, details: { reason: motivo, finalizedFromGrace: wasInGrace } });

    const embed = new EmbedBuilder()
      .setColor(COLORS.BLACK)
      .setTitle('💀☠️ Jugador eliminado — PERMADEATH')
      .addFields(
        { name: '👤 Jugador', value: `<@${targetUser.id}>`, inline: true },
        { name: '📋 Motivo',  value: wasInGrace ? `Finalizado por Staff (ya estaba en periodo de gracia — ${motivo})` : motivo, inline: true }
      )
      .setDescription(
        wasInGrace
          ? `El personaje seguía en periodo de gracia (7 días) — Staff ha adelantado el borrado en vez de esperar a que venciera solo. ` +
            `El personaje y todos sus datos (inventarios e identidad) ya se han borrado. **No hay forma de revivirlo.** ` +
            `El jugador ya puede usar \`/personaje crear\` para empezar una historia nueva.`
          : `Sin ventana de gracia: el personaje y todos sus datos (inventarios e identidad) ` +
            `ya se han borrado. **No hay forma de revivirlo.** El jugador ya puede usar \`/personaje crear\` ` +
            `para empezar una historia nueva.`
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
