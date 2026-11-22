import { ChannelType, OverwriteType, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { queryOne, query } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { getAvatarUrl } from '../utils/playerAvatar.js';
import { slugify, originPhrase, genderLabel } from '../utils/text.js';
import { listCategories, pickCategoryWithRoom } from './modmailCategoryService.js';
import { getAlertPreferences } from './playerAlertService.js';

const SQL = {
  findByModmailChannel: `SELECT * FROM ${T.players} WHERE modmail_channel_id = ?`,
  listWithChannel: `
    SELECT discord_id, username, character_name, modmail_channel_id
    FROM ${T.players}
    WHERE modmail_channel_id IS NOT NULL
  `,
};

export const PLAYER_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
];

const COLOR_FROM_PLAYER = 0x2ecc71;
const COLOR_FROM_STAFF  = 0x3498db;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)(\?.*)?$/i;

function splitAttachments(attachments) {
  const list = [...attachments.values()];
  const imageIndex = list.findIndex(a => a.contentType?.startsWith('image/') || IMAGE_EXT_RE.test(a.url));
  const imageUrl = imageIndex !== -1 ? list[imageIndex].url : null;
  const otherLines = list
    .filter((_, i) => i !== imageIndex)
    .map(a => `📎 [${a.name}](${a.url})`);
  return { imageUrl, otherLines };
}

export function mergeChannelOverwrites(categoryOverwrites, memberId, memberOverwrite) {
  const inherited = (categoryOverwrites ?? []).filter(o => String(o.id) !== String(memberId));
  return [...inherited, { id: memberId, ...memberOverwrite }];
}

export async function ensureModmailChannel(guild, player) {
  if (player.modmail_channel_id) {
    const existing = await guild.channels.fetch(player.modmail_channel_id).catch(() => null);
    if (existing) return existing;
  }

  const allChannels = await guild.channels.fetch().catch(() => null);

  if (allChannels) {
    const registeredCategoryIds = new Set((await listCategories()).map(c => c.discord_category_id));
    const marker = `(Discord: ${player.discord_id})`;
    const orphan = allChannels.find(
      c => c && registeredCategoryIds.has(c.parentId) && c.type === ChannelType.GuildText && c.topic?.includes(marker)
    );
    if (orphan) {
      logger.warn(
        `[Modmail] Canal de modmail ya existía en Discord para "${player.character_name ?? player.username}" ` +
        `(${player.discord_id}) sin que esta BD lo supiera — reutilizando #${orphan.name} (${orphan.id}) en vez de duplicarlo.`
      );
      return orphan;
    }
  }

  const category = await pickCategoryWithRoom(guild, allChannels);
  if (!category) {
    throw new Error(
      'Ninguna categoría de modmail registrada tiene hueco (Discord limita a 50 canales por categoría). ' +
      'Un Staff debe registrar una categoría nueva con `/modmail-categoria crear`, o desde la web.'
    );
  }

  const displayName = player.character_name ?? player.username;

  const categoryOverwrites = [...category.permissionOverwrites.cache.values()]
    .map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
  if (categoryOverwrites.length === 0) {
    logger.warn(
      `[Modmail] La categoría "${category.name}" (${category.id}) no tiene ninguna excepción de permiso ` +
      'configurada — el canal nuevo heredará el permiso por defecto de Discord (visible para @everyone) ' +
      'más el acceso del jugador. Revisa los permisos de la categoría si no es lo que quieres.'
    );
  }
  const permissionOverwrites = mergeChannelOverwrites(categoryOverwrites, player.discord_id, {
    type: OverwriteType.Member,
    allow: PLAYER_CHANNEL_PERMISSIONS,
  });

  let channel;
  try {
    channel = await guild.channels.create({
      name:   `rp-${slugify(displayName)}`,
      type:   ChannelType.GuildText,
      parent: category.id,
      topic:  `Canal privado de ${displayName} (Discord: ${player.discord_id}) — solo Staff y su dueño. Tanto rolear aquí directamente como escribir por MD al bot llegan al mismo sitio.`,
      permissionOverwrites,
    });
  } catch (err) {
    throw new Error(
      `No se pudo crear el canal de modmail: ${err.message}. ` +
      '¿Tiene el bot el permiso "Gestionar canales" en el servidor?'
    );
  }

  logger.info(`[Modmail] Canal creado: #${channel.name} (${channel.id}) para "${displayName}"`);

  postCharacterInfoCard(guild.client, channel.id, player)
    .catch(err => logger.warn(`[Modmail] No se pudo publicar la ficha de personaje en #${channel.name}: ${err.message}`));

  return channel;
}

const CHARACTER_CARD_TITLE_PREFIX = '📇 Ficha de';

function buildCharacterInfoEmbed(player, member) {
  const displayName = player.character_name ?? player.username;
  const embed = new EmbedBuilder()
    .setColor(COLOR_FROM_STAFF)
    .setTitle(`${CHARACTER_CARD_TITLE_PREFIX} ${displayName}`)
    .setFooter({ text: 'Ficha fijada al abrir el canal — no se actualiza sola si el personaje cambia después.' })
    .setTimestamp();

  const avatarUrl = getAvatarUrl(player, 'modmail channel card');
  if (avatarUrl) embed.setThumbnail(avatarUrl);

  if (player.full_name) embed.addFields({ name: '👤 Nombre completo', value: player.full_name, inline: true });
  if (player.nationality || player.origin_country) {
    embed.addFields({ name: '🌍 Origen', value: originPhrase(player.nationality, player.origin_country), inline: true });
  }
  if (player.gender) embed.addFields({ name: '⚧️ Género', value: genderLabel(player.gender), inline: true });
  if (player.religion) embed.addFields({ name: '🙏 Religión', value: player.religion, inline: true });
  if (player.description) embed.addFields({ name: '📝 Descripción', value: player.description });

  const accountLines = [`**Usuario:** ${member ? member.user.tag : player.username} (\`${player.discord_id}\`)`];
  if (member) {
    accountLines.push(`**Cuenta creada:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`);
    if (member.joinedTimestamp) accountLines.push(`**Se unió al servidor:** <t:${Math.floor(member.joinedTimestamp / 1000)}:D>`);
  }
  embed.addFields({ name: '💬 Cuenta de Discord', value: accountLines.join('\n') });

  return embed;
}

export async function postCharacterInfoCard(client, channelId, player) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const alreadyHasCard = recent?.some(
    m => m.author.id === client.user.id && m.embeds[0]?.title?.startsWith(CHARACTER_CARD_TITLE_PREFIX)
  );
  if (alreadyHasCard) return false;

  const member = channel.guild
    ? await channel.guild.members.fetch(player.discord_id).catch(() => null)
    : null;

  const message = await channel.send({ embeds: [buildCharacterInfoEmbed(player, member)] });
  await message.pin().catch(err =>
    logger.warn(`[Modmail] Ficha publicada pero no se pudo fijar en #${channel.name}: ${err.message}`)
  );
  return true;
}

export async function relayDmToChannel(client, player, message) {
  if (!player.modmail_channel_id) return false;

  const channel = await client.channels.fetch(player.modmail_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return false;

  const displayName = player.character_name ?? player.username;
  const avatarUrl    = getAvatarUrl(player, '[Modmail] relayDmToChannel') ?? message.author.displayAvatarURL();
  const { imageUrl, otherLines } = splitAttachments(message.attachments);

  const embed = new EmbedBuilder()
    .setColor(COLOR_FROM_PLAYER)
    .setAuthor({ name: displayName, iconURL: avatarUrl ?? undefined })
    .setDescription((message.content || '*(sin texto)*').slice(0, 4096));

  if (imageUrl) embed.setImage(imageUrl);
  if (otherLines.length > 0) embed.addFields({ name: 'Adjuntos', value: otherLines.join('\n').slice(0, 1024) });

  await channel.send({ embeds: [embed] });
  await message.react('✅').catch(() => {});
  return true;
}

export async function relayChannelToDm(client, player, message) {
  const prefs = await getAlertPreferences(player.discord_id);
  if (prefs && !prefs.channelToDm) {
    await message.react('🔕').catch(() => {});
    return false;
  }

  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (!user) return false;

  const { imageUrl, otherLines } = splitAttachments(message.attachments);

  const embed = new EmbedBuilder()
    .setColor(COLOR_FROM_STAFF)
    .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
    .setDescription((message.content || '*(sin texto)*').slice(0, 4096));

  if (imageUrl) embed.setImage(imageUrl);
  if (otherLines.length > 0) embed.addFields({ name: 'Adjuntos', value: otherLines.join('\n').slice(0, 1024) });

  const delivered = await user.send({ embeds: [embed] }).catch(err => {
    logger.warn(`[Modmail] No se pudo entregar el MD a ${player.discord_id}: ${err.message}`);
    return null;
  });

  await message.react(delivered ? '✅' : '❌').catch(() => {});
  return Boolean(delivered);
}

export async function notifyDeath(client, player, reason, { permadeath = false } = {}) {
  const user = await client.users.fetch(player.discord_id).catch(() => null);
  if (!user) return;

  const name = player.character_name ?? player.username;

  const message = permadeath
    ? `💀 Tu personaje **${name}** ha muerto de forma **permanente**.\n` +
      `**Motivo:** ${reason}\n\n` +
      `Staff ha decidido que esta muerte es definitiva: no hay ventana de gracia ni posibilidad de revivir. ` +
      `Ya puedes usar \`/personaje crear\` para empezar una historia nueva cuando quieras.`
    : `💀 Tu personaje **${name}** ha muerto.\n` +
      `**Motivo:** ${reason}\n\n` +
      `Tienes dos opciones:\n` +
      `1️⃣ **Esperar** — Staff puede revivirte hasta 7 días desde ahora con \`/revive personaje_id:${player.id}\`.\n` +
      `2️⃣ **Rendirte** — si prefieres no esperar, usa \`/personaje rendirse\` para renunciar a este personaje ` +
      `ya mismo y poder crear uno nuevo al momento. ⚠️ Es definitivo: se pierde inventario y progreso, y no hay vuelta atrás.`;

  await user.send(message).catch(() => {});
}

export function buildDeathModmailNotice(player, reason, permadeath = false) {
  const name = player.character_name ?? player.username;
  if (permadeath) {
    return (
      `💀 **${name}** ha muerto de forma **permanente**: ${reason}.\n` +
      `Sin ventana de gracia — el personaje y sus datos ya se han borrado.`
    );
  }
  return (
    `💀 **${name}** ha muerto: ${reason}.\n` +
    `Se puede revivir con \`/revive personaje_id:${player.id}\` durante los próximos 7 días, ` +
    `o el jugador puede rendirse antes con \`/personaje rendirse\` para empezar de cero ya mismo.`
  );
}

export async function notifyModmailChannel(client, channelId, message) {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(message).catch(() => {});
}

export async function closeModmailChannel(client, channelId, closingNote) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel.send(closingNote).catch(() => {});
  await channel.delete('Personaje borrado — el canal de modmail ya no hace falta').catch(err => {
    logger.warn(`[Modmail] No se pudo borrar el canal ${channelId}: ${err.message}`);
  });
  logger.info(`[Modmail] Canal de modmail cerrado y borrado (${channelId}).`);
}

export async function findPlayerByModmailChannelId(channelId) {
  return (await queryOne(SQL.findByModmailChannel, [channelId])) ?? null;
}

export async function listPlayersWithChannel() {
  return query(SQL.listWithChannel);
}
