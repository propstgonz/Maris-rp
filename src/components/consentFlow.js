import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { accept, reject, cancel } from '../services/consentService.js';
import { findPlayerById } from '../services/playerService.js';
import { buildCustomId } from '../utils/componentAuth.js';
import { actorFrom, requireLivingCharacter } from '../utils/interactionContext.js';
import { COLORS, E, clip, formatNumber, discordRelativeFromNow, discordTimestamp } from '../utils/embeds.js';
import logger from '../utils/logger.js';

export const CONSENT_NS = 'consent';
export const CONSENT_TTL_MS = 24 * 60 * 60_000;

const KIND_NOUN = {
  item: 'traspaso de bienes',
  npc: 'traspaso de NPCs',
  property: 'traspaso de propiedad',
  marriage: 'propuesta de matrimonio',
};

export function requestLine(row) {
  if (row.kind === 'item') return `${formatNumber(row.quantity)} × ${clip(row.item_display_name ?? `bien #${row.item_id}`, 80)}`;
  if (row.kind === 'npc') return `${row.npc_count} × ${clip(row.npc_name, 80)}`;
  if (row.kind === 'property') {
    const name = row.property_name ? ` «${clip(row.property_name, 60)}»` : '';
    return `${clip(row.property_type_display_name ?? 'Propiedad', 60)}${name} (#${row.property_id})`;
  }
  return 'Propuesta de matrimonio';
}

function consentButton(action, label, style, owner, requestId) {
  return new ButtonBuilder()
    .setCustomId(buildCustomId({ ns: CONSENT_NS, action, owner, ctx: String(requestId) }))
    .setLabel(label)
    .setStyle(style);
}

export function recipientRow(toDiscordId, requestId) {
  return new ActionRowBuilder().addComponents(
    consentButton('accept', 'Aceptar', ButtonStyle.Success, toDiscordId, requestId),
    consentButton('reject', 'Rechazar', ButtonStyle.Danger, toDiscordId, requestId),
  );
}

export async function sendDm(client, discordId, payload) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(payload);
    return true;
  } catch (err) {
    logger.warn(`[Consent] No se pudo enviar MD a ${discordId}: ${err.message}`);
    return false;
  }
}

export function notifyRecipient(client, { requestId, toDiscordId, fromName, kind, line }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.YELLOW)
    .setTitle(`📨 Solicitud de ${KIND_NOUN[kind]}`)
    .setDescription(
      `**${clip(fromName, 100)}** te envía: ${line}\n` +
      `Caduca ${discordRelativeFromNow(CONSENT_TTL_MS / 1000)}. También puedes resolverla con \`/solicitudes\`.`
    );
  return sendDm(client, toDiscordId, { embeds: [embed], components: [recipientRow(toDiscordId, requestId)] });
}

const OUTCOMES = {
  accept: { status: '✅ Aceptada', color: COLORS.GREEN, verb: 'ha aceptado' },
  reject: { status: '❌ Rechazada', color: COLORS.RED, verb: 'ha rechazado' },
  cancel: { status: '🚫 Cancelada', color: COLORS.GREY, verb: null },
};

async function notifySender(interaction, request, outcome, responderName) {
  if (!outcome.verb) return;
  const sender = await findPlayerById(request.from_player_id);
  if (!sender) return;
  const embed = new EmbedBuilder()
    .setColor(outcome.color)
    .setDescription(`${outcome.status.slice(0, 1)} **${clip(responderName, 100)}** ${outcome.verb} tu ${KIND_NOUN[request.kind]}.`);
  await sendDm(interaction.client, sender.discord_id, { embeds: [embed] });
}

export async function handleConsentComponent(interaction, parsed) {
  const requestId = Number(parsed.ctx);
  const outcome = OUTCOMES[parsed.action];
  if (!outcome || !Number.isInteger(requestId)) return;

  const actor = actorFrom(interaction);
  const player = await requireLivingCharacter(interaction.user.id);
  const action = { accept, reject, cancel }[parsed.action];
  const request = await action(requestId, player.id, actor);

  const base = interaction.message.embeds[0];
  const embed = (base ? EmbedBuilder.from(base) : new EmbedBuilder().setTitle(`${E.civil} Solicitud #${requestId}`))
    .setColor(outcome.color)
    .setFooter({ text: `${outcome.status} · solicitud #${requestId}` });
  await interaction.update({ embeds: [embed], components: [] });

  await notifySender(interaction, request, outcome, player.character_name);
}

const LIST_LIMIT = 10;
const INCOMING_BUTTON_ROWS = 3;
const OUTGOING_BUTTONS = 5;

function listField(title, rows, total, counterpart, nameKey) {
  const lines = rows.slice(0, LIST_LIMIT).map(row =>
    `\`#${row.id}\` ${KIND_NOUN[row.kind]}: ${requestLine(row)} — ${counterpart} **${clip(row[nameKey], 60)}** · caduca ${discordTimestamp(row.expires_at, 'R')}`
  );
  if (total > lines.length) lines.push(`…y ${total - lines.length} más`);
  return { name: `${title} (${total})`, value: clip(lines.join('\n'), 1024) };
}

export function buildRequestListView(userId, { incoming, outgoing, incomingTotal = incoming.length, outgoingTotal = outgoing.length }) {
  const embed = new EmbedBuilder().setColor(COLORS.BLUE).setTitle('📨 Solicitudes pendientes');
  if (incoming.length === 0 && outgoing.length === 0) embed.setDescription('No tienes solicitudes pendientes.');
  if (incoming.length > 0) embed.addFields(listField('📥 Recibidas', incoming, incomingTotal, 'de', 'from_character_name'));
  if (outgoing.length > 0) embed.addFields(listField('📤 Enviadas', outgoing, outgoingTotal, 'para', 'to_character_name'));

  const components = incoming.slice(0, INCOMING_BUTTON_ROWS).map(row => new ActionRowBuilder().addComponents(
    consentButton('accept', `Aceptar #${row.id}`, ButtonStyle.Success, userId, row.id),
    consentButton('reject', `Rechazar #${row.id}`, ButtonStyle.Danger, userId, row.id),
  ));
  if (outgoing.length > 0) {
    components.push(new ActionRowBuilder().addComponents(
      outgoing.slice(0, OUTGOING_BUTTONS).map(row => consentButton('cancel', `Cancelar #${row.id}`, ButtonStyle.Secondary, userId, row.id))
    ));
  }
  return { embeds: [embed], components };
}
