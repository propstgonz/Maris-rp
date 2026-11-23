import { query, queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  insert: `
    INSERT INTO ${T.audit_log} (source, actor_discord_id, actor_username, action, target, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  listDistinctActions: `
    SELECT DISTINCT action FROM ${T.audit_log} ORDER BY action ASC
  `,
  listSince: `
    SELECT id, source, actor_discord_id, actor_username, action, target, details
    FROM ${T.audit_log} WHERE id > ? ORDER BY id ASC LIMIT ?
  `,
  getMaxId: `SELECT MAX(id) AS maxId FROM ${T.audit_log}`,
  pruneOlderThan: `
    DELETE FROM ${T.audit_log}
    WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) AND action <> 'personaje.muerte'
  `,
};

export async function logAction({ actor, source, actorDiscordId, actorUsername, action, target = null, details = null }) {
  const entrySource = actor?.source ?? source;
  const entryDiscordId = actor?.discordId ?? actorDiscordId;
  const entryUsername = actor?.username ?? actorUsername;
  try {
    const detailsStr = details == null ? null : JSON.stringify(details);
    await execute(SQL.insert, [entrySource, entryDiscordId, entryUsername, action, target, detailsStr]);
  } catch (err) {
    logger.warn(`[AuditLog] No se pudo registrar la acción "${action}" (${entrySource}, ${entryUsername}): ${err.message}`);
  }
}

export async function listRecentActions({
  page = 1, pageSize = 50, actorDiscordId = null, action = null,
  source = null, prefix = null, from = null, to = null, q = null,
} = {}) {
  const conditions = [];
  const params = [];
  if (actorDiscordId) { conditions.push('actor_discord_id = ?'); params.push(actorDiscordId); }
  if (action)         { conditions.push('action = ?');           params.push(action); }
  if (source === 'web' || source === 'discord') { conditions.push('source = ?'); params.push(source); }
  if (prefix) { conditions.push("action LIKE ? ESCAPE '\\\\'"); params.push(`${prefix.replace(/[\\%_]/g, c => `\\${c}`)}.%`); }
  if (from)   { conditions.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
  if (to)     { conditions.push('created_at <= ?'); params.push(`${to} 23:59:59`); }
  if (q) {
    const like = `%${String(q).replace(/[\\%_]/g, c => `\\${c}`)}%`;
    conditions.push("(actor_username LIKE ? ESCAPE '\\\\' OR target LIKE ? ESCAPE '\\\\')");
    params.push(like, like);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;

  const rawRows = await query(`SELECT * FROM ${T.audit_log} ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  const rows = rawRows.map(row => {
    let details = null;
    if (row.details) {
      try { details = JSON.parse(row.details); } catch { details = row.details; }
    }
    return { ...row, details };
  });

  const { total } = await queryOne(`SELECT COUNT(*) AS total FROM ${T.audit_log} ${whereClause}`, params);

  return { rows, total, page: safePage, pageSize };
}

export async function listDistinctActions() {
  return (await query(SQL.listDistinctActions)).map(r => r.action);
}

export async function listActionsSince(lastId, limit = 200) {
  const rows = await query(SQL.listSince, [lastId, limit]);
  return rows.map(row => {
    if (!row.details) return row;
    try { return { ...row, details: JSON.parse(row.details) }; } catch { return row; }
  });
}

export async function getMaxActionId() {
  return (await queryOne(SQL.getMaxId))?.maxId ?? 0;
}

export async function pruneOldAuditLog(days = 30) {
  const result = await execute(SQL.pruneOlderThan, [days]);
  return result.changes;
}
