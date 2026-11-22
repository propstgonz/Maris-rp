import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getPlayerByDiscordId } from '../../services/playerService.js';
import { planPath, computePathCost, cancelTravel, getTravelStatus, beginTravel } from '../../services/travelService.js';
import { requireCharacter } from '../../utils/permissions.js';
import { COLORS } from '../../utils/embeds.js';
import { getAvatarUrl }          from '../../utils/playerAvatar.js';
import { getWorldMapUrl }        from '../../utils/publicUrl.js';
import { logAction }             from '../../services/auditLogService.js';
import logger                     from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Empieza un viaje hacia (x,y) — 3 casillas/hora')
    .addIntegerOption(opt =>
      opt
        .setName('x')
        .setDescription('Coordenada X del destino (omite junto a "y" para consultar tu viaje en curso, o usa cancelar:true)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(9999)
    )
    .addIntegerOption(opt =>
      opt
        .setName('y')
        .setDescription('Coordenada Y del destino (omite junto a "x" para consultar tu viaje en curso, o usa cancelar:true)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(9999)
    )
    .addBooleanOption(opt =>
      opt
        .setName('cancelar')
        .setDescription('Cancela tu viaje en curso (te quedas donde estés) — ignora x/y si los pones también')
        .setRequired(false)
    ),

  async execute(interaction) {
    const destX = interaction.options.getInteger('x');
    const destY = interaction.options.getInteger('y');
    const cancelar = interaction.options.getBoolean('cancelar') ?? false;

    if (cancelar) {
      if (!await requireCharacter(interaction)) return;
      const cancelled = await cancelTravel(interaction.user.id);
      if (cancelled) {
        logAction({
          source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
          action: 'travel.cancel', target: interaction.user.id, details: null,
        });
      }
      return interaction.reply({
        content: cancelled
          ? '🛑 Viaje cancelado — te quedas en tu casilla actual.'
          : 'ℹ️ No tenías ningún viaje en curso.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (destX === null || destY === null) {
      if (!await requireCharacter(interaction)) return;

      const status = await getTravelStatus(interaction.user.id);
      if (!status) {
        return interaction.reply({
          content: 'ℹ️ No estás viajando ahora mismo. Especifica `x` e `y` para empezar un viaje (o `cancelar:true` no tiene nada que hacer).',
          flags: MessageFlags.Ephemeral,
        });
      }

      const player = await getPlayerByDiscordId(interaction.user.id);
      const path = planPath(player.coord_x, player.coord_y, status.destX, status.destY);
      const stepsLeft = path.length - 1;
      const etaHours = Math.ceil((await computePathCost(path)) / status.speedMultiplier);

      const statusEmbed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setTitle(`🚶 ${player.username} está de viaje`)
        .addFields(
          { name: '📍 Posición actual', value: `(X: ${player.coord_x}, Y: ${player.coord_y})`, inline: true },
          { name: '🏁 Hacia', value: `**(X: ${status.destX}, Y: ${status.destY})**`, inline: true },
          { name: '⏱️ Llegada estimada', value: `~${etaHours}h (${stepsLeft} casilla${stepsLeft === 1 ? '' : 's'}${status.speedMultiplier !== 1 ? `, ×${status.speedMultiplier} de velocidad` : ''})` },
        )
        .setFooter({ text: 'Usa /move x y para redirigir el viaje, o /move cancelar:true para detenerte.' })
        .setTimestamp();

      return interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral });
    }

    if (!await requireCharacter(interaction)) return;
    return startTravelFor(interaction, destX, destY);
  },
};

export async function startTravelFor(interaction, destX, destY, viaComponent = false) {
  const respond = (payload) => (viaComponent
    ? interaction.update({ content: null, embeds: [], components: [], ...payload })
    : interaction.reply(payload));

  const player = await getPlayerByDiscordId(interaction.user.id);

  let trip;
  try {
    trip = await beginTravel(interaction.user.id, destX, destY);
  } catch (err) {
    return respond({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  const { steps, speedMultiplier, etaHours, redirected } = trip;

  logger.info(
    `[/move] ${interaction.user.tag} ${redirected ? 'redirigió su viaje' : 'empezó un viaje'}: ` +
    `(${trip.from.x},${trip.from.y}) → (${destX},${destY}), ${steps} casilla(s), ×${speedMultiplier}, ETA ${etaHours}h`
  );

  logAction({
    source: 'discord', actorDiscordId: interaction.user.id, actorUsername: interaction.user.tag,
    action: 'travel.start', target: interaction.user.id,
    details: { from: trip.from, to: trip.to, steps, speedMultiplier, etaHours, redirected },
  });

  const embed = new EmbedBuilder()
    .setColor(COLORS.BLUE)
    .setTitle(`🚶 ${player.username} se ha puesto en marcha`)
    .addFields(
      { name: '📍 Desde', value: `(X: ${trip.from.x}, Y: ${trip.from.y})`, inline: true },
      { name: '🏁 Hacia', value: `**(X: ${destX}, Y: ${destY})**`, inline: true },
      { name: '⏱️ Llegada estimada', value: `~${etaHours}h (${steps} casilla${steps === 1 ? '' : 's'}${speedMultiplier !== 1 ? `, ×${speedMultiplier} de velocidad` : ''})` },
    )
    .setFooter({ text: 'Sigues siendo visible y puedes ser atacado/comerciar en cada casilla por la que pases. Usa /move cancelar:true para detenerte.' })
    .setTimestamp();
  if (redirected) embed.setDescription('*Viaje anterior redirigido hacia el nuevo destino.*');

  const worldMapUrl = getWorldMapUrl();
  if (worldMapUrl) embed.setURL(worldMapUrl);

  const avatarUrl = getAvatarUrl(player, '/move');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  return respond({ embeds: [embed] });
}
