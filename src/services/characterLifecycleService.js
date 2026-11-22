import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { config } from '../utils/permissions.js';
import { discordRelativeFromNow } from '../utils/embeds.js';
import { STATS } from '../domain/picarda.js';
import { getSetting, setSetting } from './settingsService.js';
import { findPlayerById } from './playerService.js';
import { logAction } from './auditLogService.js';
import { endMarriagesOnDeathInTx } from './marriageService.js';
import { cancelAllPendingForPlayerInTx } from './consentService.js';
import {
  ensureModmailChannel,
  notifyDeath,
  notifyModmailChannel,
  buildDeathModmailNotice,
  closeModmailChannel,
} from './modmailService.js';

const GRACE_PERIOD_DAYS = 7;
const DEFAULT_CREATION_COOLDOWN_HOURS = 336;
const CHARACTER_CREATED_ROLE_ID = config.roles?.characterCreated ?? null;
const GENDERS = ['hombre', 'mujer'];
const NAME_MAX = 80;
const SYSTEM_ACTOR = { discordId: 'sistema', username: 'sistema', source: 'discord' };

const SQL = {
  getByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,
  getRaceBySlug: `SELECT id FROM ${T.races} WHERE slug = ?`,

  ensureRow: `
    INSERT INTO ${T.players} (discord_id, username) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE username = VALUES(username)
  `,

  getCooldownSecondsRemaining: `
    SELECT TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(COALESCE(character_reset_at, died_at), INTERVAL ? HOUR)) AS seconds_remaining
    FROM ${T.players}
    WHERE discord_id = ? AND COALESCE(character_reset_at, died_at) IS NOT NULL
  `,

  claimCreation: `
    UPDATE ${T.players}
    SET character_created_at = NOW(),
        character_name       = ?,
        age                  = ?,
        gender               = ?,
        race_id              = ?,
        is_alive             = 1,
        died_at              = NULL,
        updated_at           = NOW()
    WHERE discord_id = ? AND character_created_at IS NULL
  `,

  setModmailChannel: `UPDATE ${T.players} SET modmail_channel_id = ? WHERE discord_id = ?`,

  insertRegistry: `INSERT INTO ${T.character_registry} (discord_id, character_name) VALUES (?, ?)`,

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

  claimDeath: `
    UPDATE ${T.players}
    SET is_alive = 0, died_at = NOW(), updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
  `,

  claimRevive: `
    UPDATE ${T.players}
    SET is_alive = 1, died_at = NULL, updated_at = NOW()
    WHERE discord_id = ? AND is_alive = 0 AND character_created_at IS NOT NULL
  `,

  snapshotPlayer: `
    SELECT p.*, r.slug AS race_slug, m.slug AS menhir_slug
    FROM ${T.players} p
    LEFT JOIN ${T.races} r ON r.id = p.race_id
    LEFT JOIN ${T.menhirs} m ON m.id = p.menhir_id
    WHERE p.id = ?
  `,
  snapshotNpcs: `SELECT name FROM ${T.player_npcs} WHERE owner_player_id = ? FOR UPDATE`,
  snapshotGoods: `
    SELECT inv.item_id, i.name, inv.quantity
    FROM ${T.inventory} inv
    JOIN ${T.items} i ON i.id = inv.item_id
    WHERE inv.player_id = ?
    ORDER BY inv.item_id
    FOR UPDATE OF inv
  `,
  snapshotProperties: `
    SELECT pr.id, pt.name AS type, pr.name, pr.level, pr.location
    FROM ${T.properties} pr
    JOIN ${T.property_types} pt ON pt.id = pr.property_type_id
    WHERE pr.owner_player_id = ?
    ORDER BY pr.id
    FOR UPDATE OF pr
  `,
  snapshotSchools: `
    SELECT s.slug, sp.level_rank
    FROM ${T.school_progress} sp
    JOIN ${T.schools} s ON s.id = sp.school_id
    WHERE sp.player_id = ? AND sp.level_rank > 0
    ORDER BY s.sort
  `,
  snapshotSpouse: `
    SELECT sp.id, sp.discord_id, sp.character_name
    FROM ${T.marriage_members} mine
    JOIN ${T.marriage_members} other ON other.marriage_id = mine.marriage_id AND other.player_id <> mine.player_id
    JOIN ${T.players} sp ON sp.id = other.player_id
    WHERE mine.player_id = ? AND mine.open_slot = 1
  `,

  deleteNpcs: `DELETE FROM ${T.player_npcs} WHERE owner_player_id = ?`,
  deleteInventory: `DELETE FROM ${T.inventory} WHERE player_id = ?`,
  deleteProperties: `DELETE FROM ${T.properties} WHERE owner_player_id = ?`,
  deleteSchoolProgress: `DELETE FROM ${T.school_progress} WHERE player_id = ?`,
  resetProfile: `
    UPDATE ${T.players}
    SET ${STATS.map(stat => `stat_${stat} = 0`).join(', ')},
        stat_bonus_points      = 0,
        race_id                = NULL,
        menhir_id              = NULL,
        menhir_chosen_at       = NULL,
        free_school_claimed_at = NULL
    WHERE id = ?
  `,

  resetToBlank: `
    UPDATE ${T.players}
    SET character_created_at = NULL,
        character_name       = NULL,
        age                  = NULL,
        gender               = NULL,
        avatar_filename      = 'avatars/default.png',
        modmail_channel_id   = NULL,
        is_alive             = 1,
        died_at              = NULL,
        character_reset_at   = NOW(),
        updated_at           = NOW()
    WHERE id = ? AND is_alive = 0
  `,
};

function actorFields(actor) {
  return { source: actor.source, actorDiscordId: actor.discordId, actorUsername: actor.username };
}

function groupNpcs(rows) {
  const counts = new Map();
  for (const { name } of rows) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}

async function wipeHoldingsInTx(playerId) {
  await execute(SQL.deleteNpcs, [playerId]);
  await execute(SQL.deleteInventory, [playerId]);
  await execute(SQL.deleteProperties, [playerId]);
  await execute(SQL.deleteSchoolProgress, [playerId]);
  await execute(SQL.resetProfile, [playerId]);
}

async function buildSnapshotInTx(playerId) {
  const [player, npcs, goods, properties, schools, spouse] = await Promise.all([
    queryOne(SQL.snapshotPlayer, [playerId]),
    query(SQL.snapshotNpcs, [playerId]),
    query(SQL.snapshotGoods, [playerId]),
    query(SQL.snapshotProperties, [playerId]),
    query(SQL.snapshotSchools, [playerId]),
    queryOne(SQL.snapshotSpouse, [playerId]),
  ]);
  return {
    character: {
      name: player.character_name, age: player.age, gender: player.gender,
      race: player.race_slug, menhir: player.menhir_slug,
    },
    stats: Object.fromEntries(STATS.map(stat => [stat, player[`stat_${stat}`]])),
    bonusPoints: player.stat_bonus_points,
    npcs: groupNpcs(npcs),
    goods: goods.map(row => ({ itemId: row.item_id, name: row.name, quantity: Number(row.quantity) })),
    properties: properties.map(row => ({ id: row.id, type: row.type, name: row.name, level: row.level, location: row.location })),
    schools: schools.map(row => ({ slug: row.slug, rank: row.level_rank })),
    spouse: spouse ? { id: spouse.id, discordId: spouse.discord_id, characterName: spouse.character_name } : null,
  };
}

async function pruneOnePlayer(player) {
  return withTransaction(async () => {
    const { changes } = await execute(SQL.resetToBlank, [player.id]);
    if (changes === 0) return false;
    await wipeHoldingsInTx(player.id);
    return true;
  });
}

function validateCreation({ characterName, age, gender, raceSlug }) {
  const name = typeof characterName === 'string' ? characterName.trim() : '';
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new UserFacingError(`El nombre del personaje tiene que tener entre 1 y ${NAME_MAX} caracteres.`);
  }
  if (!Number.isInteger(age) || age < 1 || age > 1000) throw new UserFacingError('La edad tiene que estar entre 1 y 1000.');
  if (!GENDERS.includes(gender)) throw new UserFacingError('El género tiene que ser hombre o mujer.');
  if (typeof raceSlug !== 'string' || raceSlug.length === 0) throw new UserFacingError('Elige una raza.');
  return name;
}

function attachGuildExtras(guild, discordId, characterName) {
  queryOne(SQL.getByDiscordId, [discordId])
    .then(row => ensureModmailChannel(guild, row))
    .then(channel => execute(SQL.setModmailChannel, [channel.id, discordId]).then(() => channel))
    .then(channel => logger.info(`[CharacterLifecycle] Canal de modmail listo para "${characterName}": #${channel.name}`))
    .catch(err => logger.warn(`[CharacterLifecycle] No se pudo crear el canal de modmail de "${characterName}": ${err.message}`));

  if (CHARACTER_CREATED_ROLE_ID) {
    guild.members.fetch(discordId)
      .then(member => member.roles.add(CHARACTER_CREATED_ROLE_ID))
      .catch(err => logger.warn(`[CharacterLifecycle] No se pudo asignar el rol identificativo a "${characterName}" (${discordId}): ${err.message}`));
  }
}

export async function hasCharacter(discordId) {
  const row = await queryOne(SQL.getByDiscordId, [discordId]);
  return Boolean(row?.character_created_at);
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

export async function createCharacter(discordId, username, fields, { guild = null } = {}) {
  const characterName = validateCreation(fields);
  const race = await queryOne(SQL.getRaceBySlug, [fields.raceSlug]);
  if (!race) throw new UserFacingError('Esa raza no existe.');

  const cooldownHours = await getCharacterCreationCooldownHours();
  if (cooldownHours > 0) {
    const status = await queryOne(SQL.getCooldownSecondsRemaining, [cooldownHours, discordId]);
    if (status && status.seconds_remaining > 0) {
      throw new UserFacingError(
        `Todavía no puedes crear un personaje nuevo: podrás ${discordRelativeFromNow(status.seconds_remaining)} ` +
        '(espera desde que terminó tu anterior personaje).'
      );
    }
  }

  await execute(SQL.ensureRow, [discordId, username]);

  await withTransaction(async () => {
    const claim = await execute(SQL.claimCreation, [characterName, fields.age, fields.gender, race.id, discordId]);
    if (claim.changes === 0) throw new UserFacingError('Ya tienes un personaje creado.');
    await execute(SQL.insertRegistry, [discordId, characterName]);
  });

  logger.info(`[CharacterLifecycle] Personaje creado: "${characterName}" (${discordId})`);
  await logAction({
    source: 'discord', actorDiscordId: discordId, actorUsername: username, action: 'personaje.creado',
    target: discordId, details: { characterName, age: fields.age, gender: fields.gender, raceSlug: fields.raceSlug },
  });

  if (guild) attachGuildExtras(guild, discordId, characterName);

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

export async function killCharacter(discordId, reason, actor = SYSTEM_ACTOR) {
  const existing = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!existing) throw new UserFacingError('Ese jugador no existe.');

  const snapshot = await withTransaction(async () => {
    await cancelAllPendingForPlayerInTx(existing.id);
    const claim = await execute(SQL.claimDeath, [existing.id]);
    if (claim.changes === 0) {
      throw new UserFacingError(existing.character_created_at
        ? `${existing.character_name ?? existing.username} ya estaba muerto.`
        : `${existing.username} no tiene ningún personaje.`);
    }
    const taken = await buildSnapshotInTx(existing.id);
    await wipeHoldingsInTx(existing.id);
    await endMarriagesOnDeathInTx(existing.id);
    return taken;
  });

  logger.info(`[CharacterLifecycle] Personaje muerto: "${existing.character_name}" (${discordId}, motivo: ${reason})`);
  await logAction({
    ...actorFields(actor), action: 'personaje.muerte', target: discordId,
    details: { reason, snapshot },
  });

  return { player: await queryOne(SQL.getByDiscordId, [discordId]), snapshot };
}

export async function reviveCharacter(discordId, actor = SYSTEM_ACTOR) {
  const existing = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!existing) throw new UserFacingError('Ese jugador no existe.');
  const { changes } = await execute(SQL.claimRevive, [discordId]);
  if (changes === 0) {
    throw new UserFacingError(existing.character_created_at && existing.is_alive
      ? `${existing.character_name ?? existing.username} ya está vivo.`
      : `${existing.username} no tiene ningún personaje que revivir.`);
  }
  logger.info(`[CharacterLifecycle] Personaje revivido: "${existing.character_name}" (${discordId})`);
  await logAction({ ...actorFields(actor), action: 'personaje.revivido', target: discordId, details: {} });
  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function markDeceased(client, discordId, reason, { permadeath = false, actor = SYSTEM_ACTOR } = {}) {
  const { player } = await killCharacter(discordId, reason, actor);

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
    await pruneOnePlayer(player);
    logger.info(`[CharacterLifecycle] Permadeath: "${player.character_name}" borrado de inmediato (${discordId}, motivo: ${reason})`);
  }

  return player;
}

export async function reviveByCharacterId(playersRowId, actor = SYSTEM_ACTOR) {
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

  return reviveCharacter(player.discord_id, actor);
}

export async function pruneExpiredCharacters(client = null) {
  const expired = await query(SQL.findExpired);

  for (const player of expired) {
    await pruneOnePlayer(player);
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

  await pruneOnePlayer(player);
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
