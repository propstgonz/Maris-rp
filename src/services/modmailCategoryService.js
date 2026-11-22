



























import { ChannelType } from 'discord.js';
import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const MAX_CHANNELS_PER_CATEGORY = 50;

const SQL = {
  listAll:           `SELECT * FROM ${T.modmail_categories} ORDER BY id ASC`,
  insert:            `INSERT INTO ${T.modmail_categories} (discord_category_id, display_name) VALUES (?, ?)`,
  findByDiscordId:   `SELECT * FROM ${T.modmail_categories} WHERE discord_category_id = ?`,
  setDisplayName:    `UPDATE ${T.modmail_categories} SET display_name = ? WHERE id = ?`,
};


export async function listCategories() {
  return query(SQL.listAll);
}


export async function addCategory(discordCategoryId, displayName = null) {
  if (await queryOne(SQL.findByDiscordId, [discordCategoryId])) {
    throw new Error('Esa categoría ya está registrada para modmail.');
  }
  await execute(SQL.insert, [discordCategoryId, displayName]);
  return queryOne(SQL.findByDiscordId, [discordCategoryId]);
}


export async function pickCategoryWithRoom(guild, allChannels = null) {
  const channels = allChannels ?? await guild.channels.fetch().catch(() => null);
  for (const row of await listCategories()) {
    const category = channels
      ? channels.get(row.discord_category_id)
      : await guild.channels.fetch(row.discord_category_id).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) continue;

    if (!row.display_name) {
      await execute(SQL.setDisplayName, [category.name, row.id]);
    }

    const childCount = channels
      ? channels.filter(c => c?.parentId === category.id).size
      : guild.channels.cache.filter(c => c.parentId === category.id).size;
    if (childCount < MAX_CHANNELS_PER_CATEGORY) return category;
  }
  return null;
}


export async function createAndRegisterCategory(guild, name) {
  const existing = await listCategories();
  const lastRow = existing[existing.length - 1];
  let permissionOverwrites;
  if (lastRow) {
    const refCategory = await guild.channels.fetch(lastRow.discord_category_id).catch(() => null);
    if (refCategory?.type === ChannelType.GuildCategory) {
      permissionOverwrites = [...refCategory.permissionOverwrites.cache.values()]
        .map(o => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield }));
    }
  }

  let category;
  try {
    category = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites });
  } catch (err) {
    throw new Error(`No se pudo crear la categoría en Discord: ${err.message}`);
  }

  await addCategory(category.id, category.name);
  logger.info(`[ModmailCategory] Categoría creada y registrada: "#${category.name}" (${category.id})`);

  return { category, clonedPermissions: Boolean(permissionOverwrites) };
}
