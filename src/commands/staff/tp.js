import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getOrCreatePlayer } from '../../services/playerService.js';
import { updatePlayerPosition, getTileWithDetails } from '../../services/mapService.js';
import { cancelTravel } from '../../services/travelService.js';
import { getItemsAtTile } from '../../services/tileItemService.js';
import { requireRolepriest } from '../../utils/permissions.js';
import { buildTileInfoEmbed, COLORS } from '../../utils/embeds.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import { logAction } from '../../services/auditLogService.js';
import logger from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('tp')
    .setDescription('[Rolepriest] Teletransporta al instante, sin límite del mapa ni exigir que la casilla exista')
    .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X destino').setRequired(true).setMinValue(0).setMaxValue(9999))
    .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y destino').setRequired(true).setMinValue(0).setMaxValue(9999))
    .addUserOption(opt => opt.setName('jugador').setDescription('Jugador a teletransportar (vacío = tú mismo)').setRequired(false)),

  async execute(interaction) {
    if (!await requireRolepriest(interaction)) return;

    const destX = interaction.options.getInteger('x', true);
    const destY = interaction.options.getInteger('y', true);
    const targetUser = interaction.options.getUser('jugador') ?? interaction.user;

    const player = await getOrCreatePlayer(targetUser.id, targetUser.username);
    const prevX = player.coord_x, prevY = player.coord_y;

    let changes;
    try {
      changes = await updatePlayerPosition(targetUser.id, destX, destY);
    } catch (err) {
      return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    if (changes === 0) {
      return interaction.reply({ content: '❌ No se pudo actualizar la posición. Inténtalo de nuevo.', flags: MessageFlags.Ephemeral });
    }
    await cancelTravel(targetUser.id);

    logger.info(`[/tp] ${interaction.user.tag} teletransportó a ${targetUser.tag}: (${prevX},${prevY}) → (${destX},${destY})`);
    logAction({
      source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
      action: 'tile.player_teleport', target: `(${destX},${destY})`,
      details: { targetDiscordId: targetUser.id, from: { x: prevX, y: prevY }, to: { x: destX, y: destY } },
    });

    const tile = await getTileWithDetails(destX, destY);
    const embed = new EmbedBuilder()
      .setColor(tile ? COLORS.GREEN : COLORS.GREY)
      .setTitle(`🗺️ ${player.username} ha sido teletransportado`)
      .setDescription(`*Movido por Staff: ${interaction.user.tag}*`)
      .addFields(
        { name: '📍 Posición anterior', value: `(X: ${prevX}, Y: ${prevY})`, inline: true },
        { name: '📍 Posición actual', value: `**(X: ${destX}, Y: ${destY})**`, inline: true }
      )
      .setTimestamp();

    const avatarUrl = getAvatarUrl(player, '/tp');
    if (avatarUrl) embed.setThumbnail(avatarUrl);

    if (!tile) {
      embed.addFields({ name: '❓ Territorio desconocido', value: `La casilla (${destX}, ${destY}) no está registrada en el mapa.` });
      return interaction.reply({ embeds: [embed] });
    }
    const tileEmbed = buildTileInfoEmbed(tile, await getItemsAtTile(destX, destY));
    return interaction.reply({ embeds: [embed, tileEmbed] });
  },
};
