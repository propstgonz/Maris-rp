












import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getOrCreatePlayer, setImmortal } from '../../services/playerService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { COLORS }        from '../../utils/embeds.js';
import { getAvatarUrl }  from '../../utils/playerAvatar.js';
import logger              from '../../utils/logger.js';
import { logAction }       from '../../services/auditLogService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('inmortal')
    .setDescription('[Staff] Activa o desactiva la inmortalidad de un jugador')
    .addUserOption(opt =>
      opt.setName('jugador').setDescription('Jugador a modificar').setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('estado').setDescription('true = inmortal, false = mortal de nuevo').setRequired(true)
    ),


  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const targetUser = interaction.options.getUser('jugador', true);
    const estado      = interaction.options.getBoolean('estado', true);


    await getOrCreatePlayer(targetUser.id, targetUser.username);

    let updated;
    try {
      updated = await setImmortal(targetUser.id, estado);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    logger.info(`[/inmortal] ${interaction.user.tag} → ${targetUser.tag}: inmortalidad ${estado ? 'ACTIVADA' : 'desactivada'}`);
    logAction({ source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag, action: 'player.set_immortal', target: targetUser.id, details: { immortal: estado } });

    const embed = new EmbedBuilder()
      .setColor(estado ? COLORS.PURPLE : COLORS.BLUE)
      .setTitle(estado ? '♾️ Jugador vuelto inmortal' : '🔓 Inmortalidad retirada')
      .addFields(
        { name: '👤 Jugador', value: `<@${targetUser.id}>`, inline: true },
        { name: '❤️ Vida actual', value: `${updated.hp}`, inline: true }
      )
      .setDescription(
        estado
          ? 'No puede morir por combate, inanición, consumibles ni `/stat modify` — el HP se clampeará a 1 en vez de llegar a 0. `/kill` sigue funcionando (override deliberado de Staff).'
          : 'Vuelve a poder morir con normalidad por cualquier vía del juego.'
      )
      .setFooter({ text: `Cambiado por ${interaction.user.tag}` })
      .setTimestamp();

    const avatarUrl = getAvatarUrl(updated, '/inmortal');
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    return interaction.reply({ embeds: [embed] });
  },
};
