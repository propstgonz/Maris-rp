import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import {
  STATS, BASE_POINTS, MAX_BASE_PER_STAT, MENHIR_CHANGE_MONTHS,
  isStat, baseStats, effectiveStats, freePoints, magicPoints, validateAllocation,
  menhirChangeAvailableAt, canChangeMenhir,
} from '../domain/picarda.js';
import { logAction } from './auditLogService.js';
import { getCivilStatus } from './marriageService.js';

export { getPlayerByDiscordId } from './playerService.js';

const GENDERS = ['hombre', 'mujer'];
const MAX_BONUS_POINTS = 100;
const NAME_MAX = 191;

const STAT_SUM = STATS.map(stat => `stat_${stat}`).join(' + ');

const SQL = {
  getById: `SELECT * FROM ${T.players} WHERE id = ?`,
  getByDiscordId: `SELECT * FROM ${T.players} WHERE discord_id = ?`,
  getRaceById: `SELECT * FROM ${T.races} WHERE id = ?`,
  getRaceBySlug: `SELECT * FROM ${T.races} WHERE slug = ?`,
  getMenhirById: `SELECT * FROM ${T.menhirs} WHERE id = ?`,
  getMenhirBySlug: `SELECT * FROM ${T.menhirs} WHERE slug = ?`,
  listRaces: `SELECT * FROM ${T.races} ORDER BY sort`,
  listMenhirs: `SELECT * FROM ${T.menhirs} ORDER BY sort`,

  allocate: Object.fromEntries(STATS.map(stat => [stat, `
    UPDATE ${T.players}
    SET stat_${stat} = stat_${stat} + ?, updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
      AND stat_${stat} + ? <= ${MAX_BASE_PER_STAT}
      AND (${STAT_SUM}) + ? <= ${BASE_POINTS} + stat_bonus_points
  `])),

  correct: Object.fromEntries(STATS.map(stat => [stat, `
    UPDATE ${T.players}
    SET stat_${stat} = ?, updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
      AND (${STAT_SUM}) - stat_${stat} + ? <= ${BASE_POINTS} + stat_bonus_points
  `])),

  grantBonus: `
    UPDATE ${T.players}
    SET stat_bonus_points = stat_bonus_points + ?, updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL AND stat_bonus_points + ? <= ${MAX_BONUS_POINTS}
  `,
  setRace: `UPDATE ${T.players} SET race_id = ?, updated_at = NOW() WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL`,
  chooseMenhir: `
    UPDATE ${T.players}
    SET menhir_id = ?, menhir_chosen_at = NOW(), updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
      AND (menhir_id IS NULL OR menhir_chosen_at IS NULL OR menhir_chosen_at <= NOW() - INTERVAL ${MENHIR_CHANGE_MONTHS} MONTH)
      AND (menhir_id IS NULL OR menhir_id <> ?)
  `,
  setMenhir: `
    UPDATE ${T.players}
    SET menhir_chosen_at = IF(menhir_id IS NULL, NOW(), menhir_chosen_at), menhir_id = ?, updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
  `,
  clearMenhir: `
    UPDATE ${T.players}
    SET menhir_id = NULL, menhir_chosen_at = NULL, updated_at = NOW()
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
  `,
  updateIdentity: {
    characterName: 'character_name = ?',
    age: 'age = ?',
    gender: 'gender = ?',
  },
  insertRegistry: `INSERT INTO ${T.character_registry} (discord_id, character_name) VALUES (?, ?)`,
};

function assertPlayerId(playerId) {
  if (!Number.isInteger(playerId) || playerId < 1) throw new UserFacingError('Jugador no válido.');
}

function assertStat(stat) {
  if (!isStat(stat)) throw new UserFacingError('Esa estadística no existe.');
}

async function requirePlayerById(playerId) {
  assertPlayerId(playerId);
  const player = await queryOne(SQL.getById, [playerId]);
  if (!player) throw new UserFacingError('Ese jugador no existe.');
  return player;
}

async function requireRace(raceSlug) {
  const race = await queryOne(SQL.getRaceBySlug, [raceSlug]);
  if (!race) throw new UserFacingError('Esa raza no existe.');
  return race;
}

async function requireMenhir(menhirSlug) {
  const menhir = await queryOne(SQL.getMenhirBySlug, [menhirSlug]);
  if (!menhir) throw new UserFacingError('Ese menhir no existe.');
  return menhir;
}

function formatDate(date) {
  return date.toLocaleDateString('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
}

export async function listRaces() {
  return query(SQL.listRaces);
}

export async function listMenhirs() {
  return query(SQL.listMenhirs);
}

export async function getProfile(playerId) {
  const player = await requirePlayerById(playerId);
  const [race, menhir, civil] = await Promise.all([
    player.race_id ? queryOne(SQL.getRaceById, [player.race_id]) : null,
    player.menhir_id ? queryOne(SQL.getMenhirById, [player.menhir_id]) : null,
    getCivilStatus(playerId),
  ]);
  const effective = effectiveStats(player, race, menhir);
  return {
    player,
    race: race ?? null,
    menhir: menhir ?? null,
    base: baseStats(player),
    effective,
    freePoints: freePoints(player),
    magic: magicPoints(effective, menhir, race),
    menhirChangeAvailableAt: menhirChangeAvailableAt(player),
    civil: { label: civil.label, spouse: civil.spouse },
  };
}

export async function allocateStat(playerId, stat, n, actor) {
  assertPlayerId(playerId);
  assertStat(stat);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BASE_PER_STAT) {
    throw new UserFacingError(`Tienes que asignar entre 1 y ${MAX_BASE_PER_STAT} puntos, en números enteros.`);
  }

  const { changes } = await execute(SQL.allocate[stat], [n, playerId, n, n]);
  const player = await queryOne(SQL.getById, [playerId]);
  if (changes === 0) {
    if (!player) throw new UserFacingError('Ese jugador no existe.');
    throw new UserFacingError(validateAllocation(player, stat, n) ?? 'No se pudo asignar ese punto. Inténtalo de nuevo.');
  }

  await logAction({
    actor, action: 'perfil.stat_asignada', target: player.discord_id,
    details: { stat, points: n, value: baseStats(player)[stat], freePoints: freePoints(player) },
  });
  return player;
}

export async function grantBonusPoints(playerId, n, actor) {
  assertPlayerId(playerId);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BONUS_POINTS) {
    throw new UserFacingError(`Los puntos extra tienen que ser un entero entre 1 y ${MAX_BONUS_POINTS}.`);
  }
  const { changes } = await execute(SQL.grantBonus, [n, playerId, n]);
  const player = await requirePlayerById(playerId);
  if (changes === 0) {
    throw new UserFacingError(player.is_alive
      ? `Un jugador no puede acumular más de ${MAX_BONUS_POINTS} puntos extra.`
      : 'Ese jugador no tiene un personaje vivo.');
  }
  await logAction({
    actor, action: 'perfil.puntos_extra', target: player.discord_id,
    details: { granted: n, bonusPoints: player.stat_bonus_points },
  });
  return player;
}

export async function correctStat(playerId, stat, value, actor) {
  assertPlayerId(playerId);
  assertStat(stat);
  if (!Number.isInteger(value) || value < 0 || value > MAX_BASE_PER_STAT) {
    throw new UserFacingError(`El valor tiene que ser un entero entre 0 y ${MAX_BASE_PER_STAT}.`);
  }
  const before = await requirePlayerById(playerId);
  const { changes } = await execute(SQL.correct[stat], [value, playerId, value]);
  if (changes === 0) {
    throw new UserFacingError(before.is_alive
      ? `Con ese valor la suma de estadísticas pasaría de ${BASE_POINTS + before.stat_bonus_points} puntos (8 base + ${before.stat_bonus_points} extra).`
      : 'Ese jugador no tiene un personaje vivo.');
  }
  const player = await requirePlayerById(playerId);
  await logAction({
    actor, action: 'perfil.stat_corregida', target: player.discord_id,
    details: { stat, from: baseStats(before)[stat], to: value },
  });
  return player;
}

export async function setRace(playerId, raceSlug, actor) {
  assertPlayerId(playerId);
  const race = await requireRace(raceSlug);
  const before = await requirePlayerById(playerId);
  const { changes } = await execute(SQL.setRace, [race.id, playerId]);
  if (changes === 0) throw new UserFacingError('Ese jugador no tiene un personaje vivo.');
  await logAction({
    actor, action: 'perfil.raza_fijada', target: before.discord_id,
    details: { raceSlug, previousRaceId: before.race_id },
  });
  return queryOne(SQL.getById, [playerId]);
}

export async function chooseMenhir(playerId, menhirSlug, actor) {
  assertPlayerId(playerId);
  const menhir = await requireMenhir(menhirSlug);
  const { changes } = await execute(SQL.chooseMenhir, [menhir.id, playerId, menhir.id]);
  const player = await requirePlayerById(playerId);
  if (changes === 0) {
    if (!player.is_alive || !player.character_created_at) throw new UserFacingError('Necesitas un personaje vivo.');
    if (player.menhir_id === menhir.id) throw new UserFacingError(`Ya tienes ${menhir.name}.`);
    if (!canChangeMenhir(player)) {
      throw new UserFacingError(
        `Ya elegiste menhir. Hasta el ${formatDate(menhirChangeAvailableAt(player))} no puedes cambiarlo (${MENHIR_CHANGE_MONTHS} meses de espera).`
      );
    }
    throw new UserFacingError('No se pudo elegir el menhir. Inténtalo de nuevo.');
  }
  await logAction({
    actor, action: 'perfil.menhir_elegido', target: player.discord_id,
    details: { menhirSlug },
  });
  return player;
}

export async function setMenhir(playerId, menhirSlug, actor) {
  assertPlayerId(playerId);
  const menhir = menhirSlug === null ? null : await requireMenhir(menhirSlug);
  const before = await requirePlayerById(playerId);
  const { changes } = menhir
    ? await execute(SQL.setMenhir, [menhir.id, playerId])
    : await execute(SQL.clearMenhir, [playerId]);
  if (changes === 0) throw new UserFacingError('Ese jugador no tiene un personaje vivo.');
  await logAction({
    actor, action: 'perfil.menhir_fijado', target: before.discord_id,
    details: { menhirSlug, previousMenhirId: before.menhir_id },
  });
  return queryOne(SQL.getById, [playerId]);
}

function validateIdentity({ characterName, age, gender }) {
  const sets = [];
  const params = [];
  if (characterName !== undefined) {
    const name = typeof characterName === 'string' ? characterName.trim() : '';
    if (name.length === 0 || name.length > NAME_MAX) {
      throw new UserFacingError(`El nombre tiene que tener entre 1 y ${NAME_MAX} caracteres.`);
    }
    sets.push(SQL.updateIdentity.characterName);
    params.push(name);
  }
  if (age !== undefined) {
    if (!Number.isInteger(age) || age < 1 || age > 1000) throw new UserFacingError('La edad tiene que estar entre 1 y 1000.');
    sets.push(SQL.updateIdentity.age);
    params.push(age);
  }
  if (gender !== undefined) {
    if (!GENDERS.includes(gender)) throw new UserFacingError('El género tiene que ser hombre o mujer.');
    sets.push(SQL.updateIdentity.gender);
    params.push(gender);
  }
  if (sets.length === 0) throw new UserFacingError('No indicaste ningún campo que cambiar.');
  return { sets, params };
}

export async function setAvatar(playerId, relativeFilename, actor) {
  assertPlayerId(playerId);
  if (typeof relativeFilename !== 'string' || !/^avatars\/[\w.-]{1,200}$/.test(relativeFilename)) {
    throw new UserFacingError('Nombre de fichero de foto no válido.');
  }
  const { changes } = await execute(
    `UPDATE ${T.players} SET avatar_filename = ?, updated_at = NOW() WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL`,
    [relativeFilename, playerId]
  );
  if (changes === 0) throw new UserFacingError('Necesitas un personaje vivo para cambiar la foto.');
  const player = await queryOne(SQL.getById, [playerId]);
  await logAction({ actor, action: 'perfil.foto', target: player.discord_id, details: { avatar: relativeFilename } });
  return player;
}

export async function updateIdentity(playerId, fields, actor) {
  assertPlayerId(playerId);
  const { sets, params } = validateIdentity(fields ?? {});
  const before = await requirePlayerById(playerId);
  const newName = fields.characterName?.trim();
  const renamed = newName !== undefined && newName !== before.character_name;

  await withTransaction(async () => {
    const { changes } = await execute(
      `UPDATE ${T.players} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ? AND character_created_at IS NOT NULL`,
      [...params, playerId]
    );
    if (changes === 0) throw new UserFacingError('Ese jugador no tiene personaje.');
    if (renamed) await execute(SQL.insertRegistry, [before.discord_id, newName]);
  });

  const player = await queryOne(SQL.getById, [playerId]);
  await logAction({
    actor, action: 'perfil.identidad_editada', target: before.discord_id,
    details: {
      characterName: [before.character_name, player.character_name],
      age: [before.age, player.age],
      gender: [before.gender, player.gender],
    },
  });
  return player;
}
