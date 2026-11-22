import session from 'express-session';
import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import { toSqlDatetime, fromSqlDatetime } from '../utils/sqlDatetime.js';
import logger from '../utils/logger.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SQL = {
  get: `SELECT session, expires_at FROM ${T.web_sessions} WHERE sid = ?`,
  upsert: `INSERT INTO ${T.web_sessions} (sid, session, expires_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE session = VALUES(session), expires_at = VALUES(expires_at)`,
  destroy: `DELETE FROM ${T.web_sessions} WHERE sid = ?`,
  touch: `UPDATE ${T.web_sessions} SET expires_at = ? WHERE sid = ?`,
  clear: `DELETE FROM ${T.web_sessions}`,
  count: `SELECT COUNT(*) AS n FROM ${T.web_sessions}`,
  pruneExpired: `DELETE FROM ${T.web_sessions} WHERE expires_at <= NOW()`,
};

function expiryFor(sessionData) {
  const expires = sessionData?.cookie?.expires;
  const ms = expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
  return toSqlDatetime(new Date(ms));
}

export class MysqlSessionStore extends session.Store {
  async get(sid, callback) {
    try {
      const row = await queryOne(SQL.get, [sid]);
      if (!row) return callback(null, null);
      if (fromSqlDatetime(row.expires_at).getTime() <= Date.now()) {
        await execute(SQL.destroy, [sid]);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.session));
    } catch (err) {
      callback(err);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      await execute(SQL.upsert, [sid, JSON.stringify(sessionData), expiryFor(sessionData)]);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await execute(SQL.destroy, [sid]);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  async touch(sid, sessionData, callback) {
    try {
      await execute(SQL.touch, [expiryFor(sessionData), sid]);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  async clear(callback) {
    try {
      await execute(SQL.clear);
      callback?.(null);
    } catch (err) {
      callback?.(err);
    }
  }

  async length(callback) {
    try {
      callback(null, (await queryOne(SQL.count)).n);
    } catch (err) {
      callback(err);
    }
  }
}

export async function pruneExpiredSessions() {
  try {
    const removed = (await execute(SQL.pruneExpired)).changes;
    if (removed > 0) logger.debug(`[MysqlSessionStore] ${removed} sesión(es) caducada(s) purgada(s).`);
    return removed;
  } catch (err) {
    logger.warn(`[MysqlSessionStore] Fallo al purgar sesiones caducadas: ${err.message}`);
    return 0;
  }
}
