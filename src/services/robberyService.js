import { queryOne, execute, query } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { UserFacingError } from '../utils/errors.js';
import { COLORS } from '../utils/embeds.js';
import { combatPhrase } from '../utils/combatNarrative.js';
import { getAvatarUrl } from '../utils/playerAvatar.js';
import { getPlayerByDiscordId } from './playerService.js';
import { resolveMeleeAttack } from './combatService.js';
import { pickSurrenderLoot } from './surrenderService.js';
import { addItem } from './inventoryService.js';
import { SURRENDER_SURVIVAL_PERCENT } from '../utils/permissions.js';
import { logAction } from './auditLogService.js';

const FIGHT_PREFIX     = 'robbery_fight:';
const SURRENDER_PREFIX = 'robbery_surrender:';
const EXPIRY_MINUTES = 10;

const SQL = {
  insert: `INSERT INTO ${T.pending_robberies} (attacker_player_id, target_player_id, channel_id) VALUES (?, ?, ?)`,
  setMessage: `UPDATE ${T.pending_robberies} SET message_id = ? WHERE id = ?`,

  getPending: `
    SELECT pr.id, pr.status,
      (DATE_ADD(pr.created_at, INTERVAL ${EXPIRY_MINUTES} MINUTE) <= NOW()) AS is_expired,
      ap.discord_id AS attacker_discord_id, ap.username AS attacker_username,
      tp.discord_id AS target_discord_id, tp.username AS target_username
    FROM ${T.pending_robberies} pr
    JOIN ${T.players} ap ON ap.id = pr.attacker_player_id
    JOIN ${T.players} tp ON tp.id = pr.target_player_id
    WHERE pr.id = ?
  `,
  resolve: `UPDATE ${T.pending_robberies} SET status = ?, resolved_at = NOW() WHERE id = ? AND status = 'pending'`,
  markFought: `UPDATE ${T.pending_robberies} SET status = 'fought' WHERE id = ? AND status = 'expired'`,

  getDueExpired: `
    SELECT pr.id, pr.channel_id, pr.message_id,
      ap.discord_id AS attacker_discord_id, ap.username AS attacker_username,
      tp.discord_id AS target_discord_id, tp.username AS target_username
    FROM ${T.pending_robberies} pr
    JOIN ${T.players} ap ON ap.id = pr.attacker_player_id
    JOIN ${T.players} tp ON tp.id = pr.target_player_id
    WHERE pr.status = 'pending' AND DATE_ADD(pr.created_at, INTERVAL ${EXPIRY_MINUTES} MINUTE) <= NOW()
  `,
};

export function isRobberyButton(customId) {
  return customId.startsWith(FIGHT_PREFIX) || customId.startsWith(SURRENDER_PREFIX);
}

export async function proposeRobbery(discordId, targetDiscordId, channelId) {
  if (discordId === targetDiscordId) throw new UserFacingError('No puedes intentar saquearte a ti mismo.');

  const attacker = await getPlayerByDiscordId(discordId);
  const target = await getPlayerByDiscordId(targetDiscordId);
  if (!attacker) throw new UserFacingError('Tu perfil no está registrado. Usa `/personaje crear` para empezar a rolear.');
  if (!target) throw new UserFacingError('Ese jugador no está registrado en el juego.');
  if (!attacker.is_alive) throw new UserFacingError('No puedes saquear a nadie si tu personaje está muerto.');
  if (!target.is_alive) throw new UserFacingError(`**${target.username}** ya está muerto.`);
  if (attacker.coord_x !== target.coord_x || attacker.coord_y !== target.coord_y) {
    throw new UserFacingError(
      `Para intentar saquear a alguien, ambos tenéis que estar en la **misma casilla**.\n` +
      `📍 Tu posición: **(${attacker.coord_x}, ${attacker.coord_y})** · Posición de **${target.username}**: **(${target.coord_x}, ${target.coord_y})**`
    );
  }

  const result = await execute(SQL.insert, [attacker.id, target.id, channelId]);
  const id = result.lastInsertRowid;

  const embed = new EmbedBuilder()
    .setColor(COLORS.YELLOW)
    .setTitle('🏴‍☠️ ¡Te están saqueando!')
    .setDescription(
      `<@${attacker.discord_id}> te exige que le entregues algo de lo tuyo, <@${target.discord_id}>. ` +
      `Puedes **pelear** (te atacará de verdad) o **rendirte** (le entregas unos ítems al azar, con un ` +
      `${SURRENDER_SURVIVAL_PERCENT}% de posibilidades de que te deje ir con vida).`
    )
    .setFooter({ text: `Expira en ${EXPIRY_MINUTES} minutos — si no respondes, se resuelve como un ataque normal.` })
    .setTimestamp();
  const avatarUrl = getAvatarUrl(attacker, '/saquear');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${FIGHT_PREFIX}${id}`).setLabel('Pelear').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
    new ButtonBuilder().setCustomId(`${SURRENDER_PREFIX}${id}`).setLabel('Rendirse').setStyle(ButtonStyle.Secondary).setEmoji('🏳️')
  );

  logger.info(`[Robbery] Propuesta #${id}: ${attacker.username} → ${target.username}`);

  return { id, payload: { content: `<@${target.discord_id}>`, embeds: [embed], components: [row] } };
}

export async function markRobberyMessage(id, messageId) {
  await execute(SQL.setMessage, [messageId, id]);
}

function _meleeOutcomeLines(result, attackerName, targetName) {
  if (result.outcomeRoll === 1) {
    return [
      combatPhrase({ category: 'unarmed', outcome: 'selfHarm', attacker: attackerName, target: targetName }),
      `**${attackerName}** se hace daño con el impulso: -${result.selfDamage} HP${result.attackerKilled ? ' — ha muerto.' : ''}.`,
    ];
  }
  if (result.outcomeRoll === 2) {
    return [combatPhrase({ category: 'unarmed', outcome: 'miss', attacker: attackerName, target: targetName })];
  }
  return [
    combatPhrase({ category: 'unarmed', outcome: result.outcomeRoll === 6 ? 'crit' : 'hit', attacker: attackerName, target: targetName }),
    `-${result.damage} HP${result.killed ? ' — ha muerto.' : ` *(HP restante: ${result.targetHpAfter})*`}.`,
  ];
}

export async function handleRobberyButton(interaction) {
  const isFight = interaction.customId.startsWith(FIGHT_PREFIX);
  const robberyId = Number(interaction.customId.split(':')[1]);

  const robbery = await queryOne(SQL.getPending, [robberyId]);
  if (!robbery) {
    return interaction.update({ content: '❌ Esta propuesta ya no existe.', embeds: [], components: [] });
  }
  if (interaction.user.id !== robbery.target_discord_id) {
    return interaction.reply({ content: '❌ Esto no es tuyo — solo quien está siendo saqueado puede responder.', flags: MessageFlags.Ephemeral });
  }
  if (robbery.status !== 'pending' || robbery.is_expired) {
    const reason = robbery.is_expired && robbery.status === 'pending' ? 'ya expiró y se resolvió sola' : `ya se resolvió (${robbery.status})`;
    return interaction.update({ content: `❌ Esta propuesta ${reason}.`, embeds: [], components: [] });
  }

  const alreadyResolved = () => interaction.update({
    content: '❌ Esta propuesta ya se resolvió.', embeds: [], components: [],
  });

  if (isFight) {
    if ((await execute(SQL.resolve, ['fought', robberyId])).changes === 0) return alreadyResolved();

    let result;
    try {
      result = await resolveMeleeAttack(interaction.client, robbery.attacker_discord_id, robbery.target_discord_id);
    } catch (err) {
      return interaction.update({ content: `❌ No se pudo resolver el ataque: ${err.message}`, embeds: [], components: [] });
    }

    logAction({
      source: 'discord', actorDiscordId: robbery.attacker_discord_id, actorUsername: robbery.attacker_username,
      action: 'combat.melee_hit', target: robbery.target_discord_id,
      details: { damage: result.damage ?? 0, targetHpAfter: result.targetHpAfter, killed: result.killed, viaRobbery: true },
    });

    const lines = [`⚔️ **${robbery.target_username}** decide pelear en vez de rendirse.`,
      ..._meleeOutcomeLines(result, robbery.attacker_username, robbery.target_username)];
    return interaction.update({ content: lines.join(' '), embeds: [], components: [] });
  }

  const spared = Math.random() * 100 < SURRENDER_SURVIVAL_PERCENT;
  if ((await execute(SQL.resolve, [spared ? 'surrendered' : 'fought', robberyId])).changes === 0) {
    return alreadyResolved();
  }

  const loot = await pickSurrenderLoot(
    robbery.target_discord_id,
    item => addItem(robbery.attacker_discord_id, item.name, item.quantity)
  );
  const lootLine = loot.length > 0
    ? `Entrega ${loot.map(i => `${i.emoji ?? '📦'} **${i.display_name}**`).join(', ')} a **${robbery.attacker_username}**.`
    : 'No lleva nada que merezca la pena entregar, pero se rinde igual.';

  if (spared) {
    logAction({
      source: 'discord', actorDiscordId: robbery.target_discord_id, actorUsername: robbery.target_username,
      action: 'player.robbery_surrendered', target: robbery.attacker_discord_id,
      details: { items: loot.map(i => i.name) },
    });
    return interaction.update({
      content: `🏳️ **${robbery.target_username}** se rinde ante **${robbery.attacker_username}**. ${lootLine} Le deja ir con vida.`,
      embeds: [], components: [],
    });
  }

  let result;
  try {
    result = await resolveMeleeAttack(interaction.client, robbery.attacker_discord_id, robbery.target_discord_id);
  } catch {
    return interaction.update({
      content: `🏳️ **${robbery.target_username}** se rinde, pero **${robbery.attacker_username}** no respeta el trato. ${lootLine}`,
      embeds: [], components: [],
    });
  }

  logAction({
    source: 'discord', actorDiscordId: robbery.attacker_discord_id, actorUsername: robbery.attacker_username,
    action: 'combat.melee_hit', target: robbery.target_discord_id,
    details: { damage: result.damage ?? 0, targetHpAfter: result.targetHpAfter, killed: result.killed, betrayedSurrender: true },
  });

  const lines = [
    `🏳️ **${robbery.target_username}** se rinde ante **${robbery.attacker_username}**. ${lootLine}`,
    'No respeta el trato y ataca igualmente.',
    ..._meleeOutcomeLines(result, robbery.attacker_username, robbery.target_username),
  ];
  return interaction.update({ content: lines.join(' '), embeds: [], components: [] });
}

export async function pruneExpiredRobberies(client) {
  const due = await query(SQL.getDueExpired);

  let resolved = 0;
  for (const robbery of due) {
    if ((await execute(SQL.resolve, ['expired', robbery.id])).changes === 0) continue;

    let result;
    try {
      result = await resolveMeleeAttack(client, robbery.attacker_discord_id, robbery.target_discord_id);
    } catch (err) {
      logger.info(`[Robbery] Propuesta #${robbery.id} expiró sin poder resolverse como ataque: ${err.message}`);
      continue;
    }

    await execute(SQL.markFought, [robbery.id]);
    resolved++;
    logAction({
      source: 'discord', actorDiscordId: robbery.attacker_discord_id, actorUsername: robbery.attacker_username,
      action: 'combat.melee_hit', target: robbery.target_discord_id,
      details: { damage: result.damage ?? 0, targetHpAfter: result.targetHpAfter, killed: result.killed, expiredRobbery: true },
    });

    if (client && robbery.channel_id) {
      const lines = [`⏱️ **${robbery.target_username}** no respondió a tiempo — **${robbery.attacker_username}** ataca de verdad.`,
        ..._meleeOutcomeLines(result, robbery.attacker_username, robbery.target_username)];
      const channel = await client.channels.fetch(robbery.channel_id).catch(() => null);
      const message = robbery.message_id && channel?.isTextBased()
        ? await channel.messages.fetch(robbery.message_id).catch(() => null)
        : null;
      if (message) {
        await message.edit({ content: lines.join(' '), embeds: [], components: [] }).catch(() => {});
      } else if (channel?.isTextBased()) {
        await channel.send({ content: lines.join(' ') }).catch(() => {});
      }
    }
  }

  if (resolved > 0) logger.debug(`[Robbery] ${resolved} propuesta(s) expirada(s) resuelta(s) como ataque.`);
  return resolved;
}
