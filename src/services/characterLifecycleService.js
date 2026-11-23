import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { config } from '../utils/permissions.js';
import { STATS } from '../domain/picarda.js';
import { getSetting, setSetting } from './settingsService.js';
import { findPlayerById, lockPlayersInTx } from './playerService.js';
import { logAction } from './auditLogService.js';
import { endMarriagesOnDeathInTx, findSpouseId, lockCoupleInTx } from './marriageService.js';
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
const DEADLOCK_RETRIES = 3;
const SYSTEM_ACTOR = { discordId: 'sistema', username: 'sistema', source: 'discord' };

const SQL = {
  getByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,
  getRaceBySlug: `SELECT id FROM ${T.races} WHERE slug = ?`,

  ensureRow: `
    INSERT INTO ${T.players} (discord_id, username) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE username = VALUES(username)
  `,

  getCooldownSecondsRemaining: `
    SELECT TIMESTAMPDIFF(SECOND, NOW(), DATE_ADD(died_at, INTERVAL ? HOUR)) AS seconds_remaining
    FROM ${T.players}
    WHERE discord_id = ? AND died_at IS NOT NULL AND character_created_at IS NULL
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
      AND character_created_at IS NOT NULL
      AND died_at IS NOT NULL
      AND died_at <= DATE_SUB(NOW(), INTERVAL ${GRACE_PERIOD_DAYS} DAY)
  `,

  graceExpired: `
    SELECT id FROM ${T.players}
    WHERE id = ? AND is_alive = 0 AND died_at <= DATE_SUB(NOW(), INTERVAL ${GRACE_PERIOD_DAYS} DAY)
  `,

  claimGrace: `
    UPDATE ${T.players}
    SET is_alive = 0, died_at = NOW(), updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
  `,

  claimRevive: `
    UPDATE ${T.players}
    SET is_alive = 1, died_at = NULL, updated_at = NOW()
    WHERE discord_id = ? AND is_alive = 0 AND character_created_at IS NOT NULL
      AND died_at > DATE_SUB(NOW(), INTERVAL ${GRACE_PERIOD_DAYS} DAY)
  `,

  claimReturn: `
    UPDATE ${T.players}
    SET is_alive = 1, died_at = NULL, updated_at = NOW()
    WHERE discord_id = ? AND is_alive = 0 AND character_created_at IS NOT NULL
      AND died_at > DATE_SUB(NOW(), INTERVAL ${GRACE_PERIOD_DAYS} DAY)
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
        died_at              = COALESCE(died_at, NOW()),
        character_reset_at   = NOW(),
        updated_at           = NOW()
    WHERE id = ? AND character_created_at IS NOT NULL
  `,
};

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
  const player = await queryOne(SQL.snapshotPlayer, [playerId]);
  const npcs = await query(SQL.snapshotNpcs, [playerId]);
  const goods = await query(SQL.snapshotGoods, [playerId]);
  const properties = await query(SQL.snapshotProperties, [playerId]);
  const schools = await query(SQL.snapshotSchools, [playerId]);
  const spouse = await queryOne(SQL.snapshotSpouse, [playerId]);
  const snapshot = {
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
  return { player, snapshot };
}

async function finalizeDeathInTx(existing, spouseHint, require) {
  const label = existing.character_name ?? existing.username;
  await lockCoupleInTx(existing.id, spouseHint);
  const [state] = await lockPlayersInTx([existing.id]);
  if (!state?.character_created_at) {
    throw new UserFacingError(state?.died_at
      ? `${label} ya murió definitivamente.`
      : `${existing.username} no tiene ningún personaje.`);
  }
  if (require === 'grace' && state.is_alive) {
    throw new UserFacingError(`**${label}** sigue vivo — usa \`/kill\` para matarlo primero.`);
  }
  if (require === 'expired' && !(await queryOne(SQL.graceExpired, [existing.id]))) {
    throw new UserFacingError(`**${label}** todavía está dentro de la gracia.`);
  }
  await cancelAllPendingForPlayerInTx(existing.id);
  const { player, snapshot } = await buildSnapshotInTx(existing.id);
  await wipeHoldingsInTx(existing.id);
  await endMarriagesOnDeathInTx(existing.id);
  await execute(SQL.resetToBlank, [existing.id]);
  return { player: { ...player, is_alive: 0 }, snapshot, fromGrace: !state.is_alive };
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

function formatAvailableAt(secondsFromNow) {
  return new Date(Date.now() + secondsFromNow * 1000).toLocaleString('es-ES', {
    timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
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

export async function setCharacterCreationCooldownHours(hours, actor = SYSTEM_ACTOR) {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new UserFacingError('El cooldown debe ser un número de horas mayor o igual que 0 (0 = desactivado).');
  }
  const previous = await getCharacterCreationCooldownHours();
  await setSetting('character_creation_cooldown_hours', String(hours));
  logger.info(`[CharacterLifecycle] Cooldown de creación de personaje fijado a ${hours}h.`);
  await logAction({ actor, action: 'personaje.cooldown_creacion', details: { previous, hours } });
}

export async function getCreationWaitSeconds(discordId) {
  const cooldownHours = await getCharacterCreationCooldownHours();
  if (cooldownHours === 0) return 0;
  const status = await queryOne(SQL.getCooldownSecondsRemaining, [cooldownHours, discordId]);
  return Math.max(0, Number(status?.seconds_remaining ?? 0));
}

export async function createCharacter(discordId, username, fields, { guild = null } = {}) {
  const characterName = validateCreation(fields);
  const race = await queryOne(SQL.getRaceBySlug, [fields.raceSlug]);
  if (!race) throw new UserFacingError('Esa raza no existe.');

  const waitSeconds = await getCreationWaitSeconds(discordId);
  if (waitSeconds > 0) {
    throw new UserFacingError(
      `Todavía no puedes crear un personaje nuevo: podrás a partir del ${formatAvailableAt(waitSeconds)} UTC ` +
      '(la espera cuenta desde la muerte de tu anterior personaje).'
    );
  }

  await execute(SQL.ensureRow, [discordId, username]);

  await withTransaction(async () => {
    const row = await queryOne(SQL.getByDiscordId, [discordId]);
    if (row?.character_created_at) throw new UserFacingError('Ya tienes un personaje creado.');
    await wipeHoldingsInTx(row.id);
    const claim = await execute(SQL.claimCreation, [characterName, fields.age, fields.gender, race.id, discordId]);
    if (claim.changes === 0) throw new UserFacingError('Ya tienes un personaje creado.');
    await execute(SQL.insertRegistry, [discordId, characterName]);
  });

  logger.info(`[CharacterLifecycle] Personaje creado: "${characterName}" (${discordId})`);
  await logAction({
    actor: { source: 'discord', discordId, username }, action: 'personaje.creado',
    target: discordId, details: { characterName, age: fields.age, gender: fields.gender, raceSlug: fields.raceSlug },
  });

  if (guild) attachGuildExtras(guild, discordId, characterName);

  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function relinkModmailChannel(discordId, channelId) {
  const player = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!player) throw new UserFacingError('Ese jugador no existe.');
  if (!player.character_created_at) {
    throw new UserFacingError(`**${player.username}** no tiene ningún personaje creado — no hay a qué enlazar el canal.`);
  }
  await execute(SQL.setModmailChannel, [channelId, discordId]);
  logger.info(`[CharacterLifecycle] Canal de modmail de "${player.character_name}" (${discordId}) reenlazado a mano → ${channelId} (antes: ${player.modmail_channel_id ?? 'ninguno'})`);
  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function killCharacter(discordId, reason, actor = SYSTEM_ACTOR, { require = null } = {}) {
  const existing = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!existing) throw new UserFacingError('Ese jugador no existe.');

  const spouseHint = await findSpouseId(existing.id);
  const { player, snapshot, fromGrace } = await withTransaction(
    () => finalizeDeathInTx(existing, spouseHint, require),
    { retryOnDeadlock: DEADLOCK_RETRIES }
  );

  logger.info(`[CharacterLifecycle] Muerte definitiva: "${player.character_name}" (${discordId}, motivo: ${reason}${fromGrace ? ', desde la gracia' : ''})`);
  await logAction({ actor, action: 'personaje.muerte', target: discordId, details: { reason, fromGrace, snapshot } });

  return { player, snapshot, fromGrace };
}

export async function enterGraceDeath(discordId, reason, actor = SYSTEM_ACTOR) {
  const existing = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!existing) throw new UserFacingError('Ese jugador no existe.');

  await withTransaction(async () => {
    await lockPlayersInTx([existing.id]);
    const claim = await execute(SQL.claimGrace, [existing.id]);
    if (claim.changes === 0) {
      throw new UserFacingError(existing.character_created_at
        ? `${existing.character_name ?? existing.username} ya estaba muerto.`
        : `${existing.username} no tiene ningún personaje.`);
    }
    await cancelAllPendingForPlayerInTx(existing.id);
  }, { retryOnDeadlock: DEADLOCK_RETRIES });

  logger.info(`[CharacterLifecycle] Personaje en gracia: "${existing.character_name}" (${discordId}, motivo: ${reason})`);
  await logAction({ actor, action: 'personaje.gracia', target: discordId, details: { reason } });
  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function reviveCharacter(discordId, actor = SYSTEM_ACTOR) {
  const existing = await queryOne(SQL.getByDiscordId, [discordId]);
  if (!existing) throw new UserFacingError('Ese jugador no existe.');
  const { changes } = await execute(SQL.claimRevive, [discordId]);
  if (changes === 0) {
    if (existing.character_created_at) throw new UserFacingError(`${existing.character_name ?? existing.username} ya está vivo.`);
    throw new UserFacingError(existing.died_at
      ? `El personaje de ${existing.username} murió definitivamente y ya no se puede revivir.`
      : `${existing.username} no tiene ningún personaje que revivir.`);
  }
  logger.info(`[CharacterLifecycle] Personaje revivido: "${existing.character_name}" (${discordId})`);
  await logAction({ actor, action: 'personaje.revivido', target: discordId, details: {} });
  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function reviveOnReturn(discordId) {
  const { changes } = await execute(SQL.claimReturn, [discordId]);
  if (changes === 0) return null;
  await logAction({ actor: SYSTEM_ACTOR, action: 'personaje.revivido', target: discordId, details: { reason: 'volvió al servidor' } });
  return queryOne(SQL.getByDiscordId, [discordId]);
}

export async function markDeceased(client, discordId, reason, { permadeath = false, actor = SYSTEM_ACTOR } = {}) {
  if (!permadeath) {
    const player = await enterGraceDeath(discordId, reason, actor);
    notifyDeath(client, player, reason, { permadeath: false })
      .catch(err => logger.warn(`[CharacterLifecycle] No se pudo notificar la muerte por MD: ${err.message}`));
    if (player.modmail_channel_id) {
      notifyModmailChannel(client, player.modmail_channel_id, buildDeathModmailNotice(player, reason, false))
        .catch(err => logger.warn(`[CharacterLifecycle] No se pudo avisar en el canal de modmail: ${err.message}`));
    }
    return player;
  }

  const { player, fromGrace } = await killCharacter(discordId, reason, actor);
  notifyDeath(client, player, reason, { permadeath: true })
    .catch(err => logger.warn(`[CharacterLifecycle] No se pudo notificar la muerte por MD: ${err.message}`));
  if (player.modmail_channel_id) {
    closeModmailChannel(client, player.modmail_channel_id, buildDeathModmailNotice(player, reason, true))
      .catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
  }
  return { ...player, fromGrace };
}

export async function reviveByCharacterId(playersRowId, actor = SYSTEM_ACTOR) {
  const player = await findPlayerById(playersRowId);
  if (!player) throw new UserFacingError(`No existe ningún personaje con ID **${playersRowId}**.`);
  if (player.is_alive && player.character_created_at) {
    throw new UserFacingError(`**${player.character_name ?? player.username}** ya está vivo.`);
  }
  return reviveCharacter(player.discord_id, actor);
}

export async function pruneExpiredCharacters(client = null) {
  const expired = await query(SQL.findExpired);
  let finalized = 0;

  for (const candidate of expired) {
    try {
      const { player } = await killCharacter(
        candidate.discord_id, `pasaron los ${GRACE_PERIOD_DAYS} días de gracia`, SYSTEM_ACTOR, { require: 'expired' }
      );
      finalized++;
      logger.info(`[CharacterLifecycle] Gracia vencida, muerte definitiva: "${player.character_name}" (discord_id: ${candidate.discord_id}, murió: ${candidate.died_at})`);

      if (client && player.modmail_channel_id) {
        closeModmailChannel(
          client,
          player.modmail_channel_id,
          `Pasaron los ${GRACE_PERIOD_DAYS} días de gracia sin revivir a **${player.character_name}**. Este canal se va a borrar.`
        ).catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
      }
    } catch (err) {
      logger.warn(`[CharacterLifecycle] No se pudo finalizar a ${candidate.discord_id}: ${err.message}`);
    }
  }

  return finalized;
}

export async function finalizeGraceDeath(discordId, client = null, actor = SYSTEM_ACTOR) {
  const { player } = await killCharacter(discordId, 'finalizado por un Rolepriest durante la gracia', actor, { require: 'grace' });
  logger.info(`[CharacterLifecycle] Finalizado a mano: "${player.character_name}" (${discordId}), muerte definitiva inmediata.`);

  if (client && player.modmail_channel_id) {
    closeModmailChannel(
      client,
      player.modmail_channel_id,
      `**${player.character_name}** — un Rolepriest ha finalizado la muerte antes de que venciera la ventana de gracia. Este canal ya no hace falta y se va a borrar.`
    ).catch(err => logger.warn(`[CharacterLifecycle] No se pudo cerrar el canal de modmail: ${err.message}`));
  }

  return player;
}

export async function getCharacterHistory(discordId) {
  return query(SQL.getRegistry, [discordId]);
}
