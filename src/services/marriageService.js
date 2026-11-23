import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { civilStatusLabel } from '../domain/civilStatus.js';
import { logAction } from './auditLogService.js';
import { createRequest } from './consentService.js';
import { lockPlayersInTx } from './playerService.js';

const DEADLOCK_RETRIES = 3;

const SQL = {
  lockLivingPlayers: `
    SELECT id FROM ${T.players}
    WHERE id IN (?, ?) AND is_alive = 1 AND character_created_at IS NOT NULL
    ORDER BY id
    FOR UPDATE
  `,
  getPlayer: `SELECT id, discord_id, character_name, gender FROM ${T.players} WHERE id = ?`,
  openMembers: `SELECT player_id FROM ${T.marriage_members} WHERE player_id IN (?, ?) AND open_slot = 1`,
  pendingBetween: `
    SELECT id FROM ${T.consent_requests}
    WHERE kind = 'marriage' AND status = 'pending' AND expires_at > NOW()
      AND ((from_player_id = ? AND to_player_id = ?) OR (from_player_id = ? AND to_player_id = ?))
    LIMIT 1
  `,
  insertMarriage: `
    INSERT INTO ${T.marriages} (proposed_by_player_id, accepted_by_player_id) VALUES (?, ?)
  `,
  insertMember: `
    INSERT INTO ${T.marriage_members} (marriage_id, player_id, open_slot) VALUES (?, ?, 1)
  `,
  cancelOtherProposals: `
    UPDATE ${T.consent_requests}
    SET status = 'cancelled', resolved_at = NOW()
    WHERE kind = 'marriage' AND status = 'pending' AND id <> ?
      AND (from_player_id IN (?, ?) OR to_player_id IN (?, ?))
  `,
  openMarriageOf: `
    SELECT marriage_id FROM ${T.marriage_members} WHERE player_id = ? AND open_slot = 1 FOR UPDATE
  `,
  endMarriage: `
    UPDATE ${T.marriages} SET ended_at = NOW(), end_reason = ?, ended_by_player_id = ? WHERE id = ? AND ended_at IS NULL
  `,
  closeMembers: `UPDATE ${T.marriage_members} SET open_slot = NULL WHERE marriage_id = ?`,
  spouseOf: `
    SELECT mine.marriage_id, sp.id, sp.discord_id, sp.character_name
    FROM ${T.marriage_members} mine
    JOIN ${T.marriage_members} other ON other.marriage_id = mine.marriage_id AND other.player_id <> mine.player_id
    JOIN ${T.players} sp ON sp.id = other.player_id
    WHERE mine.player_id = ? AND mine.open_slot = 1
  `,
  spouseOfLocked: `
    SELECT mine.marriage_id, sp.id, sp.discord_id, sp.character_name
    FROM ${T.marriage_members} mine
    JOIN ${T.marriage_members} other ON other.marriage_id = mine.marriage_id AND other.player_id <> mine.player_id
    JOIN ${T.players} sp ON sp.id = other.player_id
    WHERE mine.player_id = ? AND mine.open_slot = 1
    FOR UPDATE OF mine, other
  `,
  lastEnded: `
    SELECT m.end_reason, m.ended_by_player_id
    FROM ${T.marriage_members} mm
    JOIN ${T.marriages} m ON m.id = mm.marriage_id
    JOIN ${T.players} p ON p.id = mm.player_id
    WHERE mm.player_id = ? AND m.ended_at IS NOT NULL AND m.created_at >= p.character_created_at
    ORDER BY m.ended_at DESC, m.id DESC
    LIMIT 1
  `,
};

function assertPlayerId(id) {
  if (!Number.isInteger(id) || id < 1) throw new UserFacingError('Jugador no válido.');
}

function spouseView(spouse) {
  return spouse ? { id: spouse.id, discordId: spouse.discord_id, characterName: spouse.character_name } : null;
}

export async function findSpouseId(playerId) {
  return (await queryOne(SQL.spouseOf, [playerId]))?.id ?? null;
}

export async function lockCoupleInTx(playerId, hintSpouseId = null) {
  await lockPlayersInTx([playerId, hintSpouseId]);
  const spouse = await queryOne(SQL.spouseOfLocked, [playerId]);
  if (spouse && spouse.id !== hintSpouseId) await lockPlayersInTx([playerId, hintSpouseId, spouse.id]);
  return spouse ?? null;
}

async function endOpenMarriage(playerId, reason, endedByPlayerId, notFoundMessage) {
  const open = await queryOne(SQL.openMarriageOf, [playerId]);
  if (!open) throw new UserFacingError(notFoundMessage);
  const ended = await execute(SQL.endMarriage, [reason, endedByPlayerId, open.marriage_id]);
  if (ended.changes === 0) throw new UserFacingError(notFoundMessage);
  await execute(SQL.closeMembers, [open.marriage_id]);
  return open.marriage_id;
}

async function endAndAudit(playerId, { reason, endedByPlayerId, notFoundMessage, action }, actor) {
  const hint = await findSpouseId(playerId);
  if (hint === null) throw new UserFacingError(notFoundMessage);
  const { marriageId, spouse } = await withTransaction(async () => {
    const spouseRow = await lockCoupleInTx(playerId, hint);
    return { marriageId: await endOpenMarriage(playerId, reason, endedByPlayerId, notFoundMessage), spouse: spouseRow };
  }, { retryOnDeadlock: DEADLOCK_RETRIES });
  const self = await queryOne(SQL.getPlayer, [playerId]);
  await logAction({
    actor, action, target: self?.discord_id ?? null,
    details: { marriageId, playerId, spouseId: spouse?.id ?? null },
  });
  return { marriageId, spouse: spouseView(spouse) };
}

export async function propose(fromPlayerId, toPlayerId, actor) {
  assertPlayerId(fromPlayerId);
  assertPlayerId(toPlayerId);
  if (fromPlayerId === toPlayerId) throw new UserFacingError('No puedes casarte contigo mismo.');

  const open = await query(SQL.openMembers, [fromPlayerId, toPlayerId]);
  if (open.some(row => row.player_id === fromPlayerId)) {
    throw new UserFacingError('Ya estás casado/a. Tendrías que divorciarte antes.');
  }
  if (open.length > 0) throw new UserFacingError('Esa persona ya está casada.');

  const pending = await queryOne(SQL.pendingBetween, [fromPlayerId, toPlayerId, toPlayerId, fromPlayerId]);
  if (pending) throw new UserFacingError('Ya hay una propuesta de matrimonio pendiente entre vosotros.');

  const requestId = await createRequest({ kind: 'marriage', fromPlayerId, toPlayerId });
  const [from, to] = await Promise.all([queryOne(SQL.getPlayer, [fromPlayerId]), queryOne(SQL.getPlayer, [toPlayerId])]);
  await logAction({
    actor, action: 'matrimonio.propuesto', target: to?.discord_id ?? null,
    details: { requestId, fromPlayerId, toPlayerId, from: from?.character_name, to: to?.character_name },
  });
  return requestId;
}

export async function acceptMarriageInTx(request) {
  const living = await query(SQL.lockLivingPlayers, [request.from_player_id, request.to_player_id]);
  if (living.length < 2) throw new UserFacingError('Alguno de los dos ya no tiene un personaje vivo.');

  let marriageId;
  try {
    marriageId = (await execute(SQL.insertMarriage, [request.from_player_id, request.to_player_id])).lastInsertRowid;
    await execute(SQL.insertMember, [marriageId, request.from_player_id]);
    await execute(SQL.insertMember, [marriageId, request.to_player_id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new UserFacingError('Uno de los dos ya está casado.');
    throw err;
  }

  await execute(SQL.cancelOtherProposals, [
    request.id, request.from_player_id, request.to_player_id, request.from_player_id, request.to_player_id,
  ]);
  return marriageId;
}

export async function divorce(playerId, actor) {
  assertPlayerId(playerId);
  return endAndAudit(playerId, {
    reason: 'divorcio', endedByPlayerId: playerId, notFoundMessage: 'No estás casado/a.', action: 'matrimonio.divorcio',
  }, actor);
}

export async function annul(playerId, actor) {
  assertPlayerId(playerId);
  return endAndAudit(playerId, {
    reason: 'anulacion', endedByPlayerId: null, notFoundMessage: 'Ese jugador no está casado/a.', action: 'matrimonio.anulado',
  }, actor);
}

export async function endMarriagesOnDeathInTx(playerId) {
  const open = await queryOne(SQL.openMarriageOf, [playerId]);
  if (!open) return null;
  const ended = await execute(SQL.endMarriage, ['viudedad', playerId, open.marriage_id]);
  await execute(SQL.closeMembers, [open.marriage_id]);
  return ended.changes === 0 ? null : open.marriage_id;
}

export async function getCivilStatus(playerId) {
  const [player, spouse] = await Promise.all([
    queryOne(SQL.getPlayer, [playerId]),
    queryOne(SQL.spouseOf, [playerId]),
  ]);
  const last = spouse ? null : await queryOne(SQL.lastEnded, [playerId]);
  return {
    label: civilStatusLabel({
      active: Boolean(spouse), lastEndReason: last?.end_reason,
      endedByPlayerId: last?.ended_by_player_id ?? null, playerId, gender: player?.gender,
    }),
    spouse: spouseView(spouse),
    marriageId: spouse?.marriage_id ?? null,
  };
}
