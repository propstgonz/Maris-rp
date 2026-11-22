
































import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { queryOne, execute, withTransaction } from '../database/index.js';
import { T } from '../database/tables.js';
import logger from '../utils/logger.js';
import { startGuardedInterval } from '../utils/guardedInterval.js';

const STATE_KEY = 'bot_instances';


const HEARTBEAT_MS = 30_000;


const STALE_MS = HEARTBEAT_MS * 3;


export const INSTANCE_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

const SQL = {
  get: `SELECT value FROM ${T.system_state} WHERE \`key\` = ?`,
  set: `
    INSERT INTO ${T.system_state} (\`key\`, value) VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value = VALUES(value)
  `,
};


async function readInstances() {
  const row = await queryOne(SQL.get, [STATE_KEY]);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}


async function touchAndPrune() {
  return withTransaction(async () => {
    const instances = await readInstances();
    const cutoff = Date.now() - STALE_MS;

    for (const [id, seenAt] of Object.entries(instances)) {
      if (!(new Date(seenAt).getTime() >= cutoff)) delete instances[id];
    }
    instances[INSTANCE_ID] = new Date().toISOString();

    await execute(SQL.set, [STATE_KEY, JSON.stringify(instances)]);
    return instances;
  });
}


export async function listLiveInstances() {
  const cutoff = Date.now() - STALE_MS;
  return Object.entries(await readInstances())
    .filter(([, seenAt]) => new Date(seenAt).getTime() >= cutoff)
    .map(([id, lastSeen]) => ({ id, lastSeen, isSelf: id === INSTANCE_ID }))
    .sort((a, b) => a.id.localeCompare(b.id));
}


export async function startInstanceGuard() {
  const check = async () => {
    const instances = await touchAndPrune();
    const others = Object.keys(instances).filter(id => id !== INSTANCE_ID);

    if (others.length > 0) {



      logger.error(
        `[InstanceGuard] ⚠️ HAY ${others.length + 1} INSTANCIAS DEL BOT VIVAS A LA VEZ con el mismo token. ` +
        `Todo (MD, fichas, jobs) se está procesando por duplicado. ` +
        `Esta: "${INSTANCE_ID}". Otras: ${others.map(o => `"${o}"`).join(', ')}. ` +
        'El primer tramo de cada id es el hostname (en Docker, el id corto del contenedor) — ' +
        'párala con `docker stop <contenedor>` y revisa por qué se levantó dos veces.'
      );
    }
  };

  await check();
  const timer = startGuardedInterval(check, HEARTBEAT_MS);




  timer.unref?.();
  logger.info(`[InstanceGuard] ✔ Vigilancia de instancias activa (id: ${INSTANCE_ID}, latido cada ${HEARTBEAT_MS / 1000}s).`);
  return timer;
}
