import { query, queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import { UserFacingError } from '../utils/errors.js';
import { logAction } from './auditLogService.js';
import { lockPlayersInTx } from './playerService.js';

const MAX_COUNT = 50;
const MAX_NAME = 80;
const DEADLOCK_RETRIES = 3;

const SQL = {
  aliveOwner: `
    SELECT id FROM ${T.players}
    WHERE id = ? AND is_alive = 1 AND character_created_at IS NOT NULL
    FOR UPDATE
  `,
  countByName: `SELECT COUNT(*) AS n FROM ${T.player_npcs} WHERE owner_player_id = ? AND name = ?`,
  countGroups: `SELECT COUNT(DISTINCT name) AS n FROM ${T.player_npcs} WHERE owner_player_id = ?`,
  insertRow: `INSERT INTO ${T.player_npcs} (owner_player_id, name, created_by_discord_id)`,
  transfer: (n) => `
    UPDATE ${T.player_npcs} SET owner_player_id = ?
    WHERE owner_player_id = ? AND name = ? LIMIT ${n}
  `,
  remove: (n) => `
    DELETE FROM ${T.player_npcs} WHERE owner_player_id = ? AND name = ? LIMIT ${n}
  `,
  listGrouped: (limit, offset) => `
    SELECT name, COUNT(*) AS count FROM ${T.player_npcs}
    WHERE owner_player_id = ? GROUP BY name ORDER BY name ASC LIMIT ${limit} OFFSET ${offset}
  `,
};

function validateCount(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new UserFacingError(`La cantidad debe ser un entero entre 1 y ${MAX_COUNT}.`);
  }
  return count;
}

function validateName(name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean || clean.length > MAX_NAME || /[\r\n]/.test(clean)) {
    throw new UserFacingError(`El nombre del NPC debe tener entre 1 y ${MAX_NAME} caracteres y una sola línea.`);
  }
  return clean;
}

async function requireAlive(playerId) {
  const row = await queryOne(SQL.aliveOwner, [playerId]);
  if (!row) throw new UserFacingError('Ese personaje no existe o no está vivo.');
}

async function countOf(ownerId, name) {
  const row = await queryOne(SQL.countByName, [ownerId, name]);
  return Number(row?.n ?? 0);
}

function audit(actor, action, target, details) {
  return logAction({ actor, action, target, details });
}

export async function listGrouped(ownerId, { page = 1, pageSize = 10 } = {}) {
  const size = Math.max(1, Math.min(100, Math.trunc(Number(pageSize)) || 10));
  const offset = (Math.max(1, Math.trunc(Number(page)) || 1) - 1) * size;
  const rows = await query(SQL.listGrouped(size, offset), [ownerId]);
  const totalRow = await queryOne(SQL.countGroups, [ownerId]);
  return {
    rows: rows.map(r => ({ name: r.name, count: Number(r.count) })),
    total: Number(totalRow?.n ?? 0),
  };
}

export async function addNpcs(ownerId, name, count, actor) {
  const n = validateCount(count);
  const clean = validateName(name);
  const total = await withTransaction(async () => {
    await requireAlive(ownerId);
    const placeholders = Array.from({ length: n }, () => '(?, ?, ?)').join(', ');
    const params = Array.from({ length: n }, () => [ownerId, clean, actor.discordId ?? null]).flat();
    await execute(`${SQL.insertRow} VALUES ${placeholders}`, params);
    return countOf(ownerId, clean);
  });
  await audit(actor, 'npcs.alta', String(ownerId), { name: clean, count: n, total });
  return total;
}

export async function removeNpcs(ownerId, name, count, actor) {
  const n = validateCount(count);
  const clean = validateName(name);
  const total = await withTransaction(async () => {
    const { changes } = await execute(SQL.remove(n), [ownerId, clean]);
    if (changes !== n) {
      throw new UserFacingError(`Solo tiene ${changes} NPC "${clean}".`);
    }
    return countOf(ownerId, clean);
  });
  await audit(actor, 'npcs.baja', String(ownerId), { name: clean, count: n, total });
  return total;
}

export async function transferNpcsInTx(fromId, toId, name, count) {
  const n = validateCount(count);
  const clean = validateName(name);
  if (fromId === toId) throw new UserFacingError('El destinatario debe ser otro personaje.');
  await requireAlive(toId);
  const { changes } = await execute(SQL.transfer(n), [toId, fromId, clean]);
  if (changes !== n) {
    throw new UserFacingError(`Solo tiene ${changes} NPC "${clean}".`);
  }
}

export async function adminTransferNpcs(fromId, toId, name, count, actor) {
  const clean = validateName(name);
  await withTransaction(async () => {
    await lockPlayersInTx([fromId, toId]);
    await transferNpcsInTx(fromId, toId, clean, count);
  }, { retryOnDeadlock: DEADLOCK_RETRIES });
  await audit(actor, 'npcs.traspaso', String(fromId), { name: clean, count, toPlayerId: toId });
}
