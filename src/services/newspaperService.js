import { ChannelType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { getSetting } from './settingsService.js';
import { slugify } from '../utils/text.js';
import { UserFacingError } from '../utils/errors.js';

const SQL = {
  insert: `
    INSERT INTO ${T.newspapers} (player_id, item_id, discord_channel_id, channel_name)
    VALUES (?, ?, ?, ?)
  `,
  countByPlayer: `SELECT COUNT(*) AS cnt FROM ${T.newspapers} WHERE player_id = ?`,
  getPlayerId:   `SELECT id FROM ${T.players} WHERE discord_id = ?`,
  getItemId:     `SELECT id FROM ${T.items} WHERE name = ?`,
};

async function _resolveNewspaperCategory(guild) {
  const categoryId = (await getSetting('newspaper_category_id')) ?? process.env.NEWSPAPER_CATEGORY_ID ?? null;
  if (!categoryId) {
    throw new Error(
      'No hay ninguna categoría configurada para los canales de periódico. ' +
      'Un Staff debe configurarla con `/periodico categoria`.'
    );
  }

  const category = await guild.channels.fetch(categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(
      `La categoría configurada (\`${categoryId}\`) ya no existe o no es una categoría válida. ` +
      'Reconfigúrala con `/periodico categoria`.'
    );
  }
  return category;
}

export async function createNewspaperChannel(guild, player, item) {
  const category = await _resolveNewspaperCategory(guild);

  const playerRow = await queryOne(SQL.getPlayerId, [player.discord_id]);
  const { cnt }    = await queryOne(SQL.countByPlayer, [playerRow.id]);
  const displayName = player.character_name ?? player.username;
  const channelName = `periodico-${slugify(displayName)}-${cnt + 1}`;

  let channel;
  try {
    channel = await guild.channels.create({
      name:   channelName,
      type:   ChannelType.GuildText,
      parent: category.id,
      topic:  `Periódico de ${displayName}`,
      permissionOverwrites: [
        {
          id:    guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny:  [PermissionFlagsBits.SendMessages],
        },
        {
          id:    player.discord_id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.AddReactions,
          ],
        },
      ],
    });
  } catch (err) {
    throw new Error(
      `No se pudo crear el canal del periódico: ${err.message}. ` +
      '¿Tiene el bot el permiso "Gestionar canales" en el servidor?'
    );
  }

  const itemRow = await queryOne(SQL.getItemId, [item.name]);
  await execute(SQL.insert, [playerRow.id, itemRow.id, channel.id, channel.name]);

  logger.info(`[Newspaper] Canal creado: #${channel.name} (${channel.id}) para ${displayName}`);

  await channel
    .send(
      `🗞️ **¡Bienvenido a tu periódico, ${displayName}!**\n` +
      `Este canal es tuyo: puedes escribir, gestionar mensajes y renombrarlo. ` +
      `El resto del servidor puede leerlo, pero no escribir aquí.`
    )
    .catch(err => logger.warn(`[Newspaper] No se pudo enviar el mensaje de bienvenida: ${err.message}`));

  return channel;
}

export async function createPrintingPressChannel(guild, player, chosenName) {
  const category = await _resolveNewspaperCategory(guild);

  const channelName = slugify(chosenName);
  if (!channelName || channelName === 'jugador') {
    throw new UserFacingError('Ese nombre no sirve para un canal de Discord — usa letras, números o guiones.');
  }

  const playerRow = await queryOne(SQL.getPlayerId, [player.discord_id]);
  const displayName = player.character_name ?? player.username;

  let channel;
  try {
    channel = await guild.channels.create({
      name:   channelName,
      type:   ChannelType.GuildText,
      parent: category.id,
      topic:  `Periódico de ${displayName}`,
      permissionOverwrites: [
        {
          id:    guild.roles.everyone.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny:  [PermissionFlagsBits.SendMessages],
        },
        {
          id:    player.discord_id,
          allow: PermissionsBitField.All,
        },
      ],
    });
  } catch (err) {
    throw new Error(
      `No se pudo crear el canal del periódico: ${err.message}. ` +
      '¿Tiene el bot el permiso "Gestionar canales" en el servidor?'
    );
  }

  await execute(SQL.insert, [playerRow.id, null, channel.id, channel.name]);

  logger.info(`[Newspaper] Canal de imprenta creado: #${channel.name} (${channel.id}) para ${displayName}`);

  await channel
    .send(
      `🗞️ **¡Bienvenido a tu periódico, ${displayName}!**\n` +
      `Este canal es tuyo — tienes todos los permisos sobre él.`
    )
    .catch(err => logger.warn(`[Newspaper] No se pudo enviar el mensaje de bienvenida: ${err.message}`));

  return channel;
}
