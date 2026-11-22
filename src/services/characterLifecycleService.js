import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { killPlayer, findPlayerById, revivePlayer } from './playerService.js';
import { getSetting, setSetting } from './settingsService.js';
import {
  notifyDeath,
  notifyModmailChannel,
  buildDeathModmailNotice,
  closeModmailChannel,
} from './modmailService.js';

const GRACE_PERIOD_DAYS = 7;
const DEFAULT_CREATION_COOLDOWN_HOURS = 336;

const SQL = {
  getByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,

  setModmailChannel: `UPDATE ${T.players} SET modmail_channel_id = ? WHERE discord_id = ?`,

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

  deleteInventory: `DELETE FROM ${T.inventory} WHERE player_id = ?`,

  resetToBlank: `
    UPDATE ${T.players}
    SET character_created_at = NULL,
        character_name       = NULL,
        gender               = NULL,
        avatar_filename      = 'avatars/default.png',
        modmail_channel_id   = NULL,
        is_alive             = 1,
        died_at              = NULL,
        character_reset_at   = NOW(),
        updated_at           = NOW()
    WHERE id = ?
  `,
};

async function _pruneOnePlayer(player) {
  await withTransaction(async () => {
    await execute(SQL.deleteInventory, [player.id]);
    await execute(SQL.resetToBlank, [player.id]);
  });
}

export async function hasCharacter(discordId) {
  const row = await queryOne(SQL.getByDiscordId, [discordId]);
  return Boolean(row?.character_created_at);
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

export async function reviveByCharacterId(playersRowId) {
  const player = await findPlayerById(playersRowId);
  if (!player) throw new Error(`No existe ningún personaje con ID **${playersRowId}**.`);
  if (player.is_alive) {
    throw new Error(`**${player.character_name ?? player.username}** ya está vivo.`);
  }
  if (!player.character_created_at) {
    throw new Error(
      `El personaje con ID **${playersRowId}** ya no existe (venció la gracia de ${GRACE_PERIOD_DAYS} días ` +
      `o fue permadeath) — no queda nada que revivir.`
    );
  }

  return revivePlayer(player.discord_id);
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
        `Pasaron los ${GRACE_PERIOD_DAYS} días de gracia sin revivir a **${player.character_name}**. Este canal se va a borrar.`
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
      `**${player.character_name}** — Staff ha finalizado el permadeath antes de que venciera la ventana de gracia. Este canal ya no hace falta y se va a borrar.`
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
