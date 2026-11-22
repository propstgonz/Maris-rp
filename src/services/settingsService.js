import { queryOne, execute } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';

const SQL = {
  get: `SELECT value FROM ${T.system_state} WHERE \`key\` = ?`,
  set: `INSERT INTO ${T.system_state} (\`key\`, value) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE value = VALUES(value)`,
};

const TTL_MS = 5000;
const cache = new Map();

export async function getSetting(key, fallback = null) {
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.cachedAt) < TTL_MS) return cached.value;

  const row = await queryOne(SQL.get, [key]);
  const value = row?.value ?? fallback;
  cache.set(key, { value, cachedAt: Date.now() });
  return value;
}

export async function setSetting(key, value) {
  await execute(SQL.set, [key, value]);
  cache.set(key, { value, cachedAt: Date.now() });
  logger.info(`[Settings] ${key} = ${value}`);
}
