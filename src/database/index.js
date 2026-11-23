import { createPool } from 'mysql2/promise';
import { AsyncLocalStorage } from 'node:async_hooks';
import logger from '../utils/logger.js';
import { UserFacingError } from '../utils/errors.js';
import { runMigrations, seedLegacyModmailCategory } from './migrate.js';

const connectionConfig = {
  host:     process.env.DB_HOST ?? '127.0.0.1',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
};

const RETRY_DELAY_MS = 3000;

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'EHOSTUNREACH', 'ENOTFOUND',
]);

let pool = null;
let ready = false;
let readyResolve;
export const whenReady = new Promise(resolve => { readyResolve = resolve; });

export function isDatabaseReady() {
  return ready;
}

async function connectWithRetry() {
  for (;;) {
    try {
      await runMigrations(connectionConfig);
      break;
    } catch (err) {
      if (!TRANSIENT_ERROR_CODES.has(err.code)) {
        logger.error(`[DB] Error fatal al aplicar migraciones: ${err.message}`);
        console.error(err);
        process.exit(1);
      }
      logger.warn(`[DB] MySQL todavía no responde (${err.code}) — reintentando en ${RETRY_DELAY_MS / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  pool = createPool({
    ...connectionConfig,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
    timezone: 'Z',
  });

  pool.on('connection', conn => {
    conn.query("SET time_zone = '+00:00'", err => {
      if (err) logger.error(`[DB] No se pudo fijar time_zone=+00:00 en una conexión nueva: ${err.message}`);
    });
  });

  logger.info(`[DB] Conectado → ${connectionConfig.host}:${connectionConfig.port}`);

  await seedLegacyModmailCategory(pool);

  ready = true;
  readyResolve();
}

connectWithRetry();

const transactionContext = new AsyncLocalStorage();

function inTransaction() {
  return transactionContext.getStore() !== undefined;
}

function requirePool() {
  if (!pool) throw new Error('La base de datos todavía no está lista.');
  return pool;
}

export async function query(sql, params = []) {
  const conn = transactionContext.getStore();
  const [rows] = conn ? await conn.execute(sql, params) : await requirePool().execute(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0];
}

export async function execute(sql, params = []) {
  const conn = transactionContext.getStore();
  const [result] = conn ? await conn.execute(sql, params) : await requirePool().execute(sql, params);
  return { changes: result.affectedRows, lastInsertRowid: result.insertId };
}

const DEADLOCK_ERRNO = 1213;
const DEADLOCK_BACKOFF_MS = 15;

function isDeadlock(err) {
  return err?.errno === DEADLOCK_ERRNO || err?.code === 'ER_LOCK_DEADLOCK';
}

async function runTransaction(fn) {
  const conn = await requirePool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await transactionContext.run(conn, fn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function withTransaction(fn, { retryOnDeadlock = 0 } = {}) {
  if (inTransaction()) return fn();

  for (let attempt = 0; ; attempt++) {
    try {
      return await runTransaction(fn);
    } catch (err) {
      if (!isDeadlock(err) || retryOnDeadlock === 0) throw err;
      if (attempt >= retryOnDeadlock) {
        throw new UserFacingError('Hubo un choque con otra operación, inténtalo de nuevo.');
      }
      await new Promise(resolve => setTimeout(resolve, Math.random() * DEADLOCK_BACKOFF_MS * (attempt + 1)));
    }
  }
}

export async function closePool() {
  if (pool) await pool.end();
}
