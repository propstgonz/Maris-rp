import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { config, MAX_HP, MAX_HUNGER } from '../utils/permissions.js';
import { killPlayer, findPlayerById, revivePlayer, getSpawnCoords, DEFAULT_LABURO } from './playerService.js';
import { getSetting, setSetting } from './settingsService.js';
import { discordRelativeFromNow } from '../utils/embeds.js';
import { getInventory } from './inventoryService.js';
import { spawnLoot } from './tileItemService.js';
import {
  ensureModmailChannel,
  notifyDeath,
  notifyModmailChannel,
  buildDeathModmailNotice,
  closeModmailChannel,
} from './modmailService.js';

const GRACE_PERIOD_DAYS = 7;
const DEFAULT_CREATION_COOLDOWN_HOURS = 0;
const CHARACTER_CREATED_ROLE_ID = config.roles?.characterCreated ?? null;

const SQL = {
  getByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,

  setIdentity: `
    UPDATE ${T.players}
    SET character_created_at = NOW(),
        character_name       = ?,
        full_name             = ?,
        nationality           = ?,
        origin_country        = ?,
        religion              = ?,
        description           = ?,
        gender                = ?,
        avatar_filename       = COALESCE(?, avatar_filename),
        updated_at            = NOW()
    WHERE discord_id = ?
  `,

  setModmailChannel: `
    UPDATE ${T.players} SET modmail_channel_id = ? WHERE discord_id = ?
  `,

  insertRegistry: `
    INSERT INTO ${T.character_registry} (discord_id, character_name) VALUES (?, ?)
  `,

  getRegistry: `
    SELECT character_name, created_at
    FROM ${T.character_registry}
    WHERE discord_id = ?
    ORDER BY created_at DESC
  `,

  findExpired: `
    SELECT * FROM ${T.players}
    WHERE is_alive = 0
      AND died_at IS NOT NULL
      AND died_at <= DATE_SUB(NOW(), INTERVAL ${GRACE_PERIOD_DAYS} DAY)
  `,

  deleteInventory:    `DELETE FROM ${T.inventory} WHERE player_id = ?`,
  deleteEffects:      `DELETE FROM ${T.player_effects} WHERE player_id = ?`,
  deleteLaburoBatches: `DELETE FROM ${T.laburo_batches} WHERE player_id = ?`,

  resetToBlank: `
    UPDATE ${T.players}
    SET character_created_at = NULL,
        character_name       = NULL,
        full_name             = NULL,
        nationality           = NULL,
        origin_country        = NULL,
        religion              = NULL,
        description           = NULL,
        gender                = NULL,
        avatar_filename       = 'avatars/default.png',
        modmail_channel_id    = NULL,
        hp                    = ?,
        hunger                = ?,
        laburo_base           = ?,
        coord_x               = ?,
        coord_y               = ?,
        is_alive              = 1,
        died_at               = NULL,
        last_laburo_at        = NULL,
        travel_dest_x            = NULL,
        travel_dest_y            = NULL,
        travel_next_tick_at      = NULL,
        travel_speed_multiplier  = NULL,
        travel_paused_by_npc_id  = NULL,
        last_attack_at           = NULL,
        attacks_today_count      = 0,
        attacks_today_date       = NULL,
        last_structure_attack_at = NULL,
        character_reset_at    = NOW(),
        updated_at            = NOW()
    WHERE id = ?
  `,

  getCooldownSecondsRemaining: `
    SELECT TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(character_reset_at, INTERVAL ? HOUR)) AS seconds_remaining
    FROM ${T.players} WHERE discord_id = ? AND character_reset_at IS NOT NULL
  `,
};

async function _pruneOnePlayer(player) {
  await withTransaction(async () => {
    const items = (await getInventory(player.discord_id)).filter(row => row.name !== 'laburo');
    for (const item of items) {
      await spawnLoot(player.coord_x, player.coord_y, item.name, item.quantity);
    }

    const spawn = await getSpawnCoords();

    await execute(SQL.deleteInventory, [player.id]);
    await execute(SQL.deleteEffects, [player.id]);
    await execute(SQL.deleteLaburoBatches, [player.id]);
    await execute(SQL.resetToBlank, [MAX_HP, MAX_HUNGER, DEFAULT_LABURO, spawn.x, spawn.y, player.id]);
  });
}

export async function hasCharacter(discordId) {
  const row = await queryOne(SQL.getByDiscordId, [discordId]);
  return Boolean(row?.character_created_at);
}

export async function createCharacter(client, guild, discordId, { fullName, nationality, originCountry, religion = null, description = null, gender = null, avatarFilename = null }) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (player.character_created_at) {
    throw new Error(`Ya tienes un personaje creado: **${player.character_name}**.`);
  }

  const cooldownHours = await getCharacterCreationCooldownHours();
  if (cooldownHours > 0) {
    const status = await queryOne(SQL.getCooldownSecondsRemaining, [cooldownHours, discordId]);
    if (status && status.seconds_remaining > 0) {
      throw new Error(
        `Todavía no puedes crear un personaje nuevo — podrás ${discordRelativeFromNow(status.seconds_remaining)} ` +
        `(cooldown desde que tu anterior personaje terminó).`
      );
    }
  }

  await execute(SQL.setIdentity, [fullName, fullName, nationality, originCountry, religion, description, gender, avatarFilename, discordId]);
  await execute(SQL.insertRegistry, [discordId, fullName]);

  logger.info(`[CharacterLifecycle] Personaje creado: "${fullName}" (${discordId})`);

  queryOne(SQL.getByDiscordId, [discordId])
    .then(row => ensureModmailChannel(guild, row))
    .then(channel => execute(SQL.setModmailChannel, [channel.id, discordId]).then(() => channel))
    .then(channel => {
      logger.info(`[CharacterLifecycle] Canal de modmail listo para "${fullName}": #${channel.name}`);
    })
    .catch(err => {
      logger.warn(`[CharacterLifecycle] No se pudo crear el canal de modmail de "${fullName}": ${err.message}`);
    });

  if (CHARACTER_CREATED_ROLE_ID && guild) {
    guild.members.fetch(discordId)
      .then(member => member.roles.add(CHARACTER_CREATED_ROLE_ID))
      .then(() => logger.info(`[CharacterLifecycle] Rol identificativo asignado a "${fullName}" (${discordId})`))
      .catch(err => {
        logger.warn(`[CharacterLifecycle] No se pudo asignar el rol identificativo a "${fullName}" (${discordId}): ${err.message}`);
      });
  }

  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function relinkModmailChannel(discordId, channelId) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (!player.character_created_at) {
    throw new Error(`**${player.username}** no tiene ningún personaje creado — no hay a qué enlazar el canal.`);
  }
  await execute(SQL.setModmailChannel, [channelId, discordId]);
  logger.info(`[CharacterLifecycle] Canal de modmail de "${player.character_name}" (${discordId}) reenlazado a mano → ${channelId} (antes: ${player.modmail_channel_id ?? 'ninguno'})`);
  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function updateCharacterIdentity(discordId, { fullName, nationality, originCountry, religion, description, gender, avatarFilename } = {}) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (!player.character_created_at) {
    throw new Error(`**${player.username}** todavía no ha creado un personaje — no hay nada que editar.`);
  }

  const fields = [];
  const values = [];

  const nameChanged = fullName !== undefined && fullName !== player.character_name;
  if (fullName !== undefined) {
    fields.push('full_name = ?', 'character_name = ?');
    values.push(fullName, fullName);
  }
  if (nationality !== undefined) {
    fields.push('nationality = ?');
    values.push(nationality);
  }
  if (originCountry !== undefined) {
    fields.push('origin_country = ?');
    values.push(originCountry);
  }
  if (religion !== undefined) {
    fields.push('religion = ?');
    values.push(religion);
  }
  if (description !== undefined) {
    fields.push('description = ?');
    values.push(description);
  }
  if (gender !== undefined) {
    fields.push('gender = ?');
    values.push(gender);
  }
  if (avatarFilename !== undefined) {
    fields.push('avatar_filename = ?');
    values.push(avatarFilename);
  }

  if (fields.length === 0) {
    throw new Error('No se especificó ningún campo para editar.');
  }

  fields.push(`updated_at = NOW()`);
  await execute(`UPDATE ${T.players} SET ${fields.join(', ')} WHERE discord_id = ?`, [...values, discordId]);

  if (nameChanged) {
    await execute(SQL.insertRegistry, [discordId, fullName]);
  }

  const editedFields = [
    fullName !== undefined && 'fullName',
    nationality !== undefined && 'nationality',
    originCountry !== undefined && 'originCountry',
    religion !== undefined && 'religion',
    description !== undefined && 'description',
    gender !== undefined && 'gender',
    avatarFilename !== undefined && 'avatarFilename',
  ].filter(Boolean);
  logger.info(`[CharacterLifecycle] Identidad editada por Staff (${discordId}): ${editedFields.join(', ')}`);

  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function markDeceased(client, discordId, reason, { permadeath = false } = {}) {
  const player = await killPlayer(discordId);

  notifyDeath(client, player, reason, { permadeath })
    .catch(err => logger.warn(`[CharacterLifecycle] No se pudo notificar la muerte por MD: ${err.message}`));

  if (player.modmail_channel_id) {
    const notice = buildDeathModmailNotice(player, reason, permadeath);
    if (permadeath) {
      closeModmailChannel(client, player.modmail_channel_id, notice)
        .catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
    } else {
      notifyModmailChannel(client, player.modmail_channel_id, notice)
        .catch(err => logger.warn(`[CharacterLifecycle] No se pudo avisar en el canal de modmail: ${err.message}`));
    }
  }

  if (permadeath) {
    await _pruneOnePlayer(player);
    logger.info(`[CharacterLifecycle] Permadeath: "${player.character_name}" borrado de inmediato (${discordId}, motivo: ${reason})`);
  }

  return player;
}

export async function surrenderCharacter(discordId, client = null) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (!player.character_created_at) {
    throw new Error('No tienes ningún personaje que rendir.');
  }
  if (player.is_alive) {
    throw new Error('Tu personaje sigue vivo — solo puedes rendirte después de morir.');
  }

  await _pruneOnePlayer(player);
  logger.info(`[CharacterLifecycle] "${player.character_name}" se rindió (${discordId}), borrado inmediato.`);

  if (client && player.modmail_channel_id) {
    closeModmailChannel(
      client,
      player.modmail_channel_id,
      `🏳️ **${player.character_name}** se ha rendido. Este canal ya no hace falta y se va a borrar.`
    ).catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
  }

  return player;
}

export async function reviveByCharacterId(playersRowId, hp = MAX_HP, hunger = MAX_HUNGER) {
  const player = await findPlayerById(playersRowId);
  if (!player) throw new Error(`No existe ningún personaje con ID **${playersRowId}**.`);
  if (player.is_alive) {
    throw new Error(`**${player.character_name ?? player.username}** ya está vivo.`);
  }
  if (!player.character_created_at) {
    throw new Error(
      `El personaje con ID **${playersRowId}** ya no existe (venció la gracia de ${GRACE_PERIOD_DAYS} días, ` +
      `fue permadeath, o el jugador se rindió) — no queda nada que revivir.`
    );
  }

  return await revivePlayer(player.discord_id, hp, hunger);
}

export async function pruneExpiredCharacters(client = null) {
  const expired = await query(SQL.findExpired);

  for (const player of expired) {
    await _pruneOnePlayer(player);
    logger.info(
      `[CharacterLifecycle] Personaje expirado y borrado: "${player.character_name}" ` +
      `(discord_id: ${player.discord_id}, murió: ${player.died_at})`
    );

    if (client && player.modmail_channel_id) {
      closeModmailChannel(
        client,
        player.modmail_channel_id,
        `⌛ Pasaron los ${GRACE_PERIOD_DAYS} días de gracia sin revivir a **${player.character_name}**. Este canal se va a borrar.`
      ).catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
    }
  }

  return expired.length;
}

export async function finalizeGraceDeath(discordId, client = null) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new Error(`Jugador no encontrado: discord_id="${discordId}"`);
  if (!player.character_created_at) {
    throw new Error('No tiene ningún personaje — nada que finalizar.');
  }
  if (player.is_alive) {
    throw new Error(`**${player.character_name}** sigue vivo — usa \`/kill\` para matarlo primero.`);
  }

  await _pruneOnePlayer(player);
  logger.info(`[CharacterLifecycle] Finalizado a mano por Staff: "${player.character_name}" (${discordId}), borrado inmediato (estaba en periodo de gracia).`);

  if (client && player.modmail_channel_id) {
    closeModmailChannel(
      client,
      player.modmail_channel_id,
      `🔒 **${player.character_name}** — Staff ha finalizado el permadeath antes de que venciera la ventana de gracia. Este canal ya no hace falta y se va a borrar.`
    ).catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
  }

  return player;
}

export async function getCharacterHistory(discordId) {
  return query(SQL.getRegistry, [discordId]);
}

export async function getCharacterCreationCooldownHours() {
  const raw = await getSetting('character_creation_cooldown_hours', String(DEFAULT_CREATION_COOLDOWN_HOURS));
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CREATION_COOLDOWN_HOURS;
}

export async function setCharacterCreationCooldownHours(hours) {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error('El cooldown debe ser un número de horas ≥ 0 (0 = desactivado).');
  }
  await setSetting('character_creation_cooldown_hours', String(hours));
  logger.info(`[CharacterLifecycle] Cooldown de creación de personaje fijado a ${hours}h.`);
}
