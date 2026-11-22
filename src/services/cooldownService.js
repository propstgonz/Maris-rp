import { execute } from '../database/index.js';

const STATEMENTS = new Map();

function statementsFor(table, ownerColumn) {
  const key = `${table}.${ownerColumn}`;
  if (!STATEMENTS.has(key)) {
    STATEMENTS.set(key, {
      first: `INSERT IGNORE INTO ${table} (${ownerColumn}, player_id, last_used_at) VALUES (?, ?, NOW())`,
      renew: `
        UPDATE ${table} SET last_used_at = NOW()
        WHERE ${ownerColumn} = ? AND player_id = ?
          AND last_used_at <= DATE_SUB(NOW(), INTERVAL ? SECOND)
      `,
    });
  }
  return STATEMENTS.get(key);
}

// Dos sentencias y no un ON DUPLICATE KEY UPDATE con IF(): mysql2 conecta con
// CLIENT_FOUND_ROWS, así que `changes` cuenta filas ENCONTRADAS y un UPDATE que
// no cambia nada seguiría contando como 1. La condición tiene que ir en el WHERE.
export async function claimCooldown(table, ownerColumn, ownerId, playerId, cooldownSeconds) {
  const sql = statementsFor(table, ownerColumn);
  if ((await execute(sql.first, [ownerId, playerId])).changes > 0) return true;
  return (await execute(sql.renew, [ownerId, playerId, cooldownSeconds])).changes > 0;
}
