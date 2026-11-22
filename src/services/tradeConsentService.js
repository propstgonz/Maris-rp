import { queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import { getAvatarUrl } from '../utils/playerAvatar.js';
import { resolveGuild, config } from '../utils/permissions.js';
import { tradeBetweenPlayers } from './tradeService.js';
import { getPlayerByDiscordId } from './playerService.js';

const TRANSACTIONS_CHANNEL = config.channels?.transactions;

const ACCEPT_PREFIX  = 'trade_accept:';
const DECLINE_PREFIX = 'trade_decline:';
const EXPIRY_MINUTES = 10;

const SQL = {
  getItemByName: `SELECT id, name, display_name, emoji FROM ${T.items} WHERE name = ?`,

  insert: `
    INSERT INTO ${T.pending_trades} (from_player_id, to_player_id, item_id, quantity) VALUES (?, ?, ?, ?)
  `,

  getPending: `
    SELECT pt.id, pt.status, pt.quantity,
      (DATE_ADD(pt.created_at, INTERVAL ${EXPIRY_MINUTES} MINUTE) <= NOW()) AS is_expired,
      fp.discord_id AS from_discord_id, fp.username AS from_username,
      tp.discord_id AS to_discord_id, tp.username AS to_username,
      i.name AS item_name, i.display_name AS item_display_name, i.emoji AS item_emoji
    FROM ${T.pending_trades} pt
    JOIN ${T.players} fp ON fp.id = pt.from_player_id
    JOIN ${T.players} tp ON tp.id = pt.to_player_id
    JOIN ${T.items} i    ON i.id  = pt.item_id
    WHERE pt.id = ?
  `,

  resolve: `
    UPDATE ${T.pending_trades} SET status = ?, resolved_at = NOW()
    WHERE id = ? AND status = 'pending'
      AND DATE_ADD(created_at, INTERVAL ${EXPIRY_MINUTES} MINUTE) > NOW()
  `,

  pruneExpired: `
    UPDATE ${T.pending_trades} SET status = 'expired', resolved_at = NOW()
    WHERE status = 'pending' AND DATE_ADD(created_at, INTERVAL ${EXPIRY_MINUTES} MINUTE) <= NOW()
  `,
};

export function isTradeConsentButton(customId) {
  return customId.startsWith(ACCEPT_PREFIX) || customId.startsWith(DECLINE_PREFIX);
}

export async function createPendingTrade(fromDiscordId, toDiscordId, itemName, quantity, coord) {
  const from = await getPlayerByDiscordId(fromDiscordId);
  const to = await getPlayerByDiscordId(toDiscordId);
  if (!from) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!to) throw new UserFacingError('El jugador destino no está registrado en el juego.');
  if (!to.is_alive) throw new UserFacingError(`No puedes comerciar con **${to.username}**: está muerto.`);

  if (from.coord_x !== to.coord_x || from.coord_y !== to.coord_y) {
    throw new UserFacingError(
      `Para proponer un trade, ambos jugadores deben estar en la **misma casilla del mapa**.\n` +
      `📍 Tu posición: **(${from.coord_x}, ${from.coord_y})** · Posición de **${to.username}**: **(${to.coord_x}, ${to.coord_y})**`
    );
  }

  const item = await queryOne(SQL.getItemByName, [itemName.toLowerCase().trim()]);
  if (!item) throw new UserFacingError(`El ítem "${itemName}" no existe en el catálogo.`);

  const result = await execute(SQL.insert, [from.id, to.id, item.id, quantity]);
  const id = result.lastInsertRowid;

  const embed = new EmbedBuilder()
    .setColor(COLORS.DARK)
    .setTitle('🤝 Propuesta de intercambio')
    .setDescription(
      `<@${from.discord_id}> quiere darte ${item.emoji ?? '📦'} **${item.display_name}** ×${quantity}, ` +
      `<@${to.discord_id}>. ¿Lo aceptas?`
    )
    .addFields({ name: '📍 Casilla', value: `(X: ${coord.x}, Y: ${coord.y})`, inline: true })
    .setFooter({ text: `Expira en 10 minutos si nadie responde` })
    .setTimestamp();
  const avatarUrl = getAvatarUrl(from, '/trade');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ACCEPT_PREFIX}${id}`).setLabel('Aceptar').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`${DECLINE_PREFIX}${id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger).setEmoji('❌')
  );

  logger.info(`[TradeConsent] Oferta #${id} creada: ${from.username} → ${to.username}: ${quantity} ${item.name}`);

  return { id, payload: { content: `<@${to.discord_id}>`, embeds: [embed], components: [row] }, item };
}

export async function handleTradeConsentButton(interaction) {
  const accept = interaction.customId.startsWith(ACCEPT_PREFIX);
  const tradeId = Number(interaction.customId.split(':')[1]);

  const trade = await queryOne(SQL.getPending, [tradeId]);
  if (!trade) {
    return interaction.update({ content: '❌ Esta propuesta ya no existe.', embeds: [], components: [] });
  }

  if (interaction.user.id !== trade.to_discord_id) {
    return interaction.reply({ content: '❌ Esta propuesta no es tuya — solo quien la recibe puede aceptarla o rechazarla.', flags: MessageFlags.Ephemeral });
  }

  if (trade.status !== 'pending' || trade.is_expired) {
    const reason = trade.is_expired && trade.status === 'pending' ? 'ha expirado' : `ya se resolvió (${trade.status})`;
    return interaction.update({ content: `❌ Esta propuesta ${reason}.`, embeds: [], components: [] });
  }

  const alreadyResolved = () => interaction.update({
    content: '❌ Esta propuesta ya se resolvió o expiró.', embeds: [], components: [],
  });

  if (!accept) {
    if ((await execute(SQL.resolve, ['declined', tradeId])).changes === 0) return alreadyResolved();
    logger.info(`[TradeConsent] Oferta #${tradeId} rechazada por ${interaction.user.tag}`);
    return interaction.update({ content: `❌ **${trade.to_username}** ha rechazado el intercambio.`, embeds: [], components: [] });
  }

  let result;
  try {
    result = await withTransaction(async () => {
      if ((await execute(SQL.resolve, ['accepted', tradeId])).changes === 0) return null;
      return tradeBetweenPlayers(trade.from_discord_id, trade.to_discord_id, trade.item_name, trade.quantity);
    });
  } catch (err) {
    await execute(SQL.resolve, ['declined', tradeId]);
    return interaction.update({ content: `❌ No se pudo completar: ${err.message}`, embeds: [], components: [] });
  }

  if (!result) return alreadyResolved();

  logger.info(`[TradeConsent] Oferta #${tradeId} aceptada por ${interaction.user.tag}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.GREEN)
    .setTitle('🤝 Intercambio completado')
    .setDescription(`**${result.from.username}** entregó ${result.item.emoji ?? '📦'} **${result.item.display_name}** ×${result.quantity} a **${result.to.username}**.`)
    .addFields({ name: '📍 Casilla', value: `(X: ${result.coord.x}, Y: ${result.coord.y})`, inline: true })
    .setFooter({ text: 'Operación registrada en el log de transacciones' })
    .setTimestamp();

  await interaction.update({ content: null, embeds: [embed], components: [] });

  if (TRANSACTIONS_CHANNEL) {
    const guild = resolveGuild(interaction);
    const channel = await guild?.channels.fetch(TRANSACTIONS_CHANNEL).catch(() => null);
    if (channel?.isTextBased() && channel.id !== interaction.channelId) {
      await channel.send({ embeds: [embed] }).catch(err =>
        logger.warn(`[TradeConsent] No se pudo enviar al canal de transacciones: ${err.message}`)
      );
    }
  }

  return result;
}

export async function pruneExpiredTrades() {
  const result = await execute(SQL.pruneExpired);
  if (result.changes > 0) {
    logger.debug(`[TradeConsent] ${result.changes} oferta(s) de trade expirada(s).`);
  }
  return result.changes;
}
