import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { logAction } from './auditLogService.js';
import { UserFacingError } from '../utils/errors.js';
import { rollDie } from '../utils/dice.js';
import { fromSqlDatetime } from '../utils/sqlDatetime.js';
import { effectiveStats, magicPoints } from '../domain/picarda.js';
import {
  RETRY_DAYS, MAX_RANK, FREE_SCHOOL_MIN_AUTISMO, attemptModifier, isSuccess, mentorQualifies, canClaimFreeSchool,
} from '../domain/magic.js';

const SQL = {
  listSchools:  `SELECT * FROM ${T.schools} ORDER BY sort`,
  schoolBySlug: `SELECT * FROM ${T.schools} WHERE slug = ?`,
  levels:       `SELECT \`rank\`, name, threshold, requires_mentor FROM ${T.mastery_levels} ORDER BY \`rank\``,
  player: `
    SELECT p.*, r.mod_potencia, r.mod_intuicion, r.mod_chiripa, r.mod_autismo, r.mod_resistencia,
           r.mod_donjuanismo, r.mod_agilidad
    FROM ${T.players} p
    LEFT JOIN ${T.races} r ON r.id = p.race_id
    WHERE p.id = ?
  `,
  menhir: `SELECT m.* FROM ${T.menhirs} m JOIN ${T.players} p ON p.menhir_id = m.id WHERE p.id = ?`,
  progress:     `SELECT level_rank, retry_after FROM ${T.school_progress} WHERE player_id = ? AND school_id = ?`,
  progressLocked: `SELECT level_rank, retry_after FROM ${T.school_progress} WHERE player_id = ? AND school_id = ? FOR UPDATE`,
  playerLocked: `SELECT is_alive, character_created_at, free_school_claimed_at FROM ${T.players} WHERE id = ? FOR UPDATE`,
  allProgress:  `SELECT school_id, level_rank, retry_after FROM ${T.school_progress} WHERE player_id = ?`,
  ensureProgress: `
    INSERT INTO ${T.school_progress} (player_id, school_id, level_rank) VALUES (?, ?, 0)
    ON DUPLICATE KEY UPDATE level_rank = level_rank
  `,
  claimFree: `
    UPDATE ${T.players} p
    LEFT JOIN ${T.races} r ON r.id = p.race_id
    LEFT JOIN ${T.menhirs} m ON m.id = p.menhir_id
    SET p.free_school_claimed_at = NOW()
    WHERE p.id = ? AND p.is_alive = 1 AND p.character_created_at IS NOT NULL AND p.free_school_claimed_at IS NULL
      AND p.stat_autismo + COALESCE(r.mod_autismo, 0) + COALESCE(m.mod_autismo, 0) >= ${FREE_SCHOOL_MIN_AUTISMO}
  `,
  grantFreeRank: `
    INSERT INTO ${T.school_progress} (player_id, school_id, level_rank) VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE retry_after = NULL, level_rank = IF(level_rank = 0, 1, level_rank)
  `,
  claimRoll: `
    UPDATE ${T.school_progress} sp
    JOIN ${T.schools} s ON s.id = sp.school_id AND s.is_active = 1
    JOIN ${T.players} p ON p.id = sp.player_id AND p.is_alive = 1 AND p.character_created_at IS NOT NULL
    SET sp.retry_after = NOW() + INTERVAL ${RETRY_DAYS} DAY
    WHERE sp.player_id = ? AND sp.school_id = ? AND sp.level_rank = ?
      AND (sp.retry_after IS NULL OR sp.retry_after <= NOW())
  `,
  promote: `
    UPDATE ${T.school_progress} SET level_rank = ?, retry_after = NULL
    WHERE player_id = ? AND school_id = ? AND level_rank = ?
  `,
  insertAttempt: `
    INSERT INTO ${T.magic_attempts}
      (player_id, school_id, target_rank, mentor_player_id, mentor_label, authorized_by_discord_id,
       roll, modifier, total, threshold, success)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  mentor: `
    SELECT p.id, COALESCE(sp.level_rank, 0) AS level_rank
    FROM ${T.players} p
    LEFT JOIN ${T.school_progress} sp ON sp.player_id = p.id AND sp.school_id = ?
    WHERE p.id = ? AND p.is_alive = 1 AND p.character_created_at IS NOT NULL
  `,
  setLevel: `
    UPDATE ${T.school_progress} SET level_rank = ?, retry_after = NULL
    WHERE player_id = ? AND school_id = ? AND level_rank <> ?
  `,
  spellColumns: `
    s.slug AS school_slug, s.name AS school, ml.name AS levelName, sp.min_rank, sp.name,
    sp.cost_amount, sp.cost_resource, sp.description
  `,
  spellFrom: `
    FROM ${T.spells} sp
    JOIN ${T.schools} s ON s.id = sp.school_id AND s.is_active = 1
    JOIN ${T.mastery_levels} ml ON ml.\`rank\` = sp.min_rank
  `,
};

const SPELL_ORDER = 'ORDER BY s.sort, sp.min_rank, sp.sort';
const STALE = 'El nivel de esa escuela cambió mientras tanto; vuelve a intentarlo.';

function toSpell(row) {
  return {
    school: row.school,
    school_slug: row.school_slug,
    levelName: row.levelName,
    min_rank: Number(row.min_rank),
    name: row.name,
    cost_amount: Number(row.cost_amount),
    cost_resource: row.cost_resource,
    description: row.description,
  };
}

function auditEntry(actor, action, target, details) {
  return {
    source: actor.source,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    action,
    target,
    details,
  };
}

async function loadPlayer(playerId) {
  const player = await queryOne(SQL.player, [playerId]);
  if (!player) throw new UserFacingError('Ese jugador no existe.');
  const menhir = await queryOne(SQL.menhir, [playerId]);
  return { player, menhir, effective: effectiveStats(player, player, menhir) };
}

function levelNameOf(levels, rank) {
  return rank > 0 ? levels.find(row => Number(row.rank) === rank).name : 'Sin nivel';
}

async function loadSchool(slug, { requireActive = true } = {}) {
  const school = await queryOne(SQL.schoolBySlug, [slug]);
  if (!school) throw new UserFacingError('Esa escuela no existe.');
  if (requireActive && !school.is_active) {
    throw new UserFacingError(`La escuela de ${school.name} está excluida hasta nuevo aviso.`);
  }
  return school;
}

function stamp(date) {
  const epoch = Math.floor(date.getTime() / 1000);
  return `<t:${epoch}:D> (<t:${epoch}:R>)`;
}

export async function listSchools({ includeInactive = false } = {}) {
  const rows = await query(SQL.listSchools);
  return rows
    .filter(school => includeInactive || school.is_active)
    .map(school => ({ ...school, secondary_divisor: Number(school.secondary_divisor) }));
}

export async function getSchoolsOverview(playerId) {
  const { player, menhir, effective } = await loadPlayer(playerId);
  const [schools, levels, progress] = await Promise.all([
    query(SQL.listSchools),
    query(SQL.levels),
    query(SQL.allProgress, [playerId]),
  ]);
  const byRank = new Map(levels.map(level => [Number(level.rank), level]));
  const progressBySchool = new Map(progress.map(row => [row.school_id, row]));

  const rows = schools.map(school => {
    const row = progressBySchool.get(school.id);
    const rank = Number(row?.level_rank ?? 0);
    const active = Boolean(school.is_active);
    const nextLevel = active ? byRank.get(rank + 1) : null;
    return {
      school,
      rank,
      levelName: rank > 0 ? byRank.get(rank).name : null,
      next: nextLevel
        ? { rank: Number(nextLevel.rank), name: nextLevel.name, threshold: Number(nextLevel.threshold), requiresMentor: Boolean(Number(nextLevel.requires_mentor)) }
        : null,
      retryAfter: fromSqlDatetime(row?.retry_after ?? null),
      active,
    };
  });

  return {
    schools: rows,
    magic: magicPoints(effective, menhir, player),
    canClaimFreeSchool: Boolean(player.is_alive && player.character_created_at) && canClaimFreeSchool(effective, player),
  };
}

export async function claimFreeSchool(playerId, schoolSlug, actor) {
  const { school, target } = await withTransaction(async () => {
    const found = await loadSchool(schoolSlug);
    const { player } = await loadPlayer(playerId);
    await queryOne(SQL.playerLocked, [playerId]);
    await execute(SQL.ensureProgress, [playerId, found.id]);
    const progress = await queryOne(SQL.progressLocked, [playerId, found.id]);
    if (Number(progress.level_rank) >= 1) {
      throw new UserFacingError(`Ya tienes nivel en la escuela de ${found.name}: no hace falta la escuela gratuita.`);
    }
    const { changes } = await execute(SQL.claimFree, [playerId]);
    if (changes === 0) {
      const locked = await queryOne(SQL.playerLocked, [playerId]);
      if (!locked.is_alive || !locked.character_created_at) throw new UserFacingError('Ese personaje está muerto.');
      if (locked.free_school_claimed_at) throw new UserFacingError('Ya reclamaste tu escuela gratuita.');
      throw new UserFacingError(`Necesitas Autismo efectivo ${FREE_SCHOOL_MIN_AUTISMO} o más para la escuela gratuita.`);
    }
    await execute(SQL.grantFreeRank, [playerId, found.id]);
    return { school: found, target: player.discord_id };
  });

  await logAction(auditEntry(actor, 'magia.escuela_gratuita', target, { escuela: school.slug }));
  return { school: school.slug, name: school.name, rank: 1 };
}

async function checkMentor({ schoolId, level, targetRank, playerId, mentorPlayerId, mentorLabel }) {
  const needsMentor = Boolean(Number(level.requires_mentor));
  if (mentorPlayerId != null) {
    if (Number(mentorPlayerId) === Number(playerId)) throw new UserFacingError('No puedes ser tu propio mentor.');
    const mentor = await queryOne(SQL.mentor, [schoolId, mentorPlayerId]);
    if (!mentor) throw new UserFacingError('El mentor indicado no existe o está muerto.');
    if (needsMentor && !mentorQualifies(mentor.level_rank, targetRank)) {
      throw new UserFacingError(`El mentor debe tener nivel ${targetRank} o superior en esa escuela.`);
    }
  } else if (needsMentor && !mentorLabel) {
    throw new UserFacingError('Este nivel exige un mentor: indica un jugador o la palabra del Rolepriest sobre un NPC.');
  }
}

export async function authorizedRoll({ playerId, schoolSlug, mentorPlayerId = null, mentorLabel = null, actor }) {
  const outcome = await withTransaction(async () => {
    await queryOne(SQL.playerLocked, [playerId]);
    const school = await loadSchool(schoolSlug);
    const { player, effective } = await loadPlayer(playerId);
    if (!player.is_alive || !player.character_created_at) throw new UserFacingError('Ese personaje está muerto.');

    await execute(SQL.ensureProgress, [playerId, school.id]);
    const current = await queryOne(SQL.progressLocked, [playerId, school.id]);
    const currentRank = Number(current.level_rank);
    if (currentRank >= MAX_RANK) throw new UserFacingError('Ya es Maestro de esa escuela: no hay nivel superior.');
    const targetRank = currentRank + 1;

    const { changes } = await execute(SQL.claimRoll, [playerId, school.id, currentRank]);
    if (changes === 0) {
      const fresh = await queryOne(SQL.progressLocked, [playerId, school.id]);
      const retryAfter = fromSqlDatetime(fresh?.retry_after ?? null);
      if (retryAfter && retryAfter > new Date()) {
        throw new UserFacingError(`No puede reintentar esa escuela hasta el ${stamp(retryAfter)}.`);
      }
      throw new UserFacingError(STALE);
    }

    const levels = await query(SQL.levels);
    const level = levels.find(row => Number(row.rank) === targetRank);
    await checkMentor({ schoolId: school.id, level, targetRank, playerId, mentorPlayerId, mentorLabel });

    const threshold = Number(level.threshold);
    const roll = rollDie(20);
    const modifier = attemptModifier(effective, school);
    const total = roll + modifier;
    const success = isSuccess(total, threshold);

    if (success) {
      const promoted = await execute(SQL.promote, [targetRank, playerId, school.id, currentRank]);
      if (promoted.changes === 0) throw new UserFacingError(STALE);
    }
    await execute(SQL.insertAttempt, [
      playerId, school.id, targetRank, mentorPlayerId, mentorLabel, actor.discordId,
      roll, modifier, total, threshold, success ? 1 : 0,
    ]);
    const after = await queryOne(SQL.progress, [playerId, school.id]);

    return {
      school, player, mentorPlayerId, mentorLabel,
      result: {
        roll, modifier, total, threshold, success, targetRank,
        levelName: level.name,
        retryAfter: success ? null : fromSqlDatetime(after.retry_after),
      },
    };
  }, { retryOnDeadlock: 3 });

  await logAction(auditEntry(actor, 'magia.tirada', outcome.player.discord_id, {
    escuela: outcome.school.slug,
    nivelObjetivo: outcome.result.targetRank,
    tirada: outcome.result.roll,
    total: outcome.result.total,
    umbral: outcome.result.threshold,
    exito: outcome.result.success,
    mentorJugador: outcome.mentorPlayerId,
    mentorPalabra: outcome.mentorLabel,
  }));
  return outcome.result;
}

export async function setLevel(playerId, schoolSlug, rank, actor) {
  const newRank = Number(rank);
  if (!Number.isInteger(newRank) || newRank < 0 || newRank > MAX_RANK) {
    throw new UserFacingError('El nivel debe ser un entero entre 0 y 5.');
  }
  const { school, player, levelName, previous } = await withTransaction(async () => {
    const found = await loadSchool(schoolSlug);
    const { player: row } = await loadPlayer(playerId);
    if (!row.is_alive || !row.character_created_at) throw new UserFacingError('Ese personaje está muerto.');
    await execute(SQL.ensureProgress, [playerId, found.id]);
    const before = await queryOne(SQL.progressLocked, [playerId, found.id]);
    await execute(SQL.setLevel, [newRank, playerId, found.id, newRank]);
    const levels = await query(SQL.levels);
    return {
      school: found, player: row, levelName: levelNameOf(levels, newRank),
      previous: { rank: Number(before.level_rank), retryAfter: before.retry_after },
    };
  });

  const details = { escuela: school.slug, nivel: newRank, nivelAnterior: previous.rank };
  if (previous.rank !== newRank && previous.retryAfter) details.retryAfterAnterior = previous.retryAfter;
  await logAction(auditEntry(actor, 'magia.nivel', player.discord_id, details));
  return { school: school.slug, rank: newRank, levelName };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

export async function getUnlockedSpells(playerId, { schoolSlug = null, page = 1, pageSize = 10 } = {}) {
  const limit = Math.min(positiveInt(pageSize, 10), 100);
  const offset = (positiveInt(page, 1) - 1) * limit;
  const filter = schoolSlug ? 'AND s.slug = ?' : '';
  const school = schoolSlug ? await queryOne(SQL.schoolBySlug, [schoolSlug]) : null;
  const menhir = await queryOne(SQL.menhir, [playerId]);
  const from = `
    ${SQL.spellFrom}
    JOIN ${T.school_progress} prog ON prog.school_id = sp.school_id AND prog.player_id = ?
    WHERE sp.min_rank <= prog.level_rank ${filter}
  `;
  const params = schoolSlug ? [playerId, schoolSlug] : [playerId];

  const [rows, count] = await Promise.all([
    query(`SELECT ${SQL.spellColumns} ${from} ${SPELL_ORDER} LIMIT ${limit} OFFSET ${offset}`, params),
    queryOne(`SELECT COUNT(*) AS total ${from}`, params),
  ]);
  return {
    rows: rows.map(toSpell),
    total: Number(count.total),
    schoolName: school?.name ?? null,
    magicToLife: Number(menhir?.magic_to_life ?? 0) === 1,
  };
}

export async function getNextSpells(playerId, schoolSlug) {
  const school = await loadSchool(schoolSlug, { requireActive: false });
  if (!school.is_active) return [];
  const progress = await queryOne(SQL.progress, [playerId, school.id]);
  const nextRank = Number(progress?.level_rank ?? 0) + 1;
  if (nextRank > MAX_RANK) return [];
  const rows = await query(
    `SELECT ${SQL.spellColumns} ${SQL.spellFrom} WHERE s.id = ? AND sp.min_rank = ? ${SPELL_ORDER}`,
    [school.id, nextRank]
  );
  return rows.map(toSpell);
}
