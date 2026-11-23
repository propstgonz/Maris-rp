import { createConnection } from 'mysql2/promise';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SCHEMAS } from './tables.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations', 'mysql');

const MIGRATION_FILE_PATTERN = /^\d{3}_(rp_(?:players|world|economy|ops))(?:_.*)?\.sql$/;

export function schemaForMigrationFile(filename) {
  const match = MIGRATION_FILE_PATTERN.exec(filename);
  if (!match) throw new Error(`Nombre de migración no válido: ${filename}`);
  return match[1];
}

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

export async function seedLegacyModmailCategory(conn) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS count FROM ${SCHEMAS.ops}.modmail_categories`
  );
  if (row.count > 0) return;

  const [[legacyRow]] = await conn.query(
    `SELECT value FROM ${SCHEMAS.ops}.system_state WHERE \`key\` = 'modmail_category_id'`
  );
  const legacyId = legacyRow?.value ?? process.env.MODMAIL_CATEGORY_ID ?? null;
  if (!legacyId) return;

  await conn.query(
    `INSERT IGNORE INTO ${SCHEMAS.ops}.modmail_categories (discord_category_id, display_name) VALUES (?, NULL)`,
    [legacyId]
  );
  logger.info(`[DB] Categoría de modmail legada (${legacyId}) migrada a la tabla modmail_categories.`);
}

const MIGRATION_LOCK = 'rp_migrations';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 600;

export async function runMigrations(connectionConfig, { untilFilename } = {}) {
  const conn = await createConnection({ ...connectionConfig, timezone: 'Z' });
  let locked = false;
  try {
    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, ?) AS acquired', [MIGRATION_LOCK, MIGRATION_LOCK_TIMEOUT_SECONDS]);
    if (Number(lockRow.acquired) !== 1) {
      throw new Error(`No se pudo obtener el lock de migraciones '${MIGRATION_LOCK}' en ${MIGRATION_LOCK_TIMEOUT_SECONDS}s.`);
    }
    locked = true;

    for (const schema of Object.values(SCHEMAS)) {
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${schema}\` CHARACTER SET utf8mb4`);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMAS.ops}.schema_migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        filename VARCHAR(191) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const allFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const lastIndex = untilFilename ? allFiles.indexOf(untilFilename) : allFiles.length - 1;
    if (untilFilename && lastIndex < 0) throw new Error(`Migración inexistente: ${untilFilename}`);
    for (const file of allFiles.slice(0, lastIndex + 1)) {
      const [[{ count }]] = await conn.query(
        `SELECT COUNT(*) AS count FROM ${SCHEMAS.ops}.schema_migrations WHERE filename = ?`,
        [file]
      );
      if (count > 0) continue;

      await conn.query(`USE \`${schemaForMigrationFile(file)}\``);
      const statements = splitStatements(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
      for (const statement of statements) {
        await conn.query(statement);
      }
      await conn.query(
        `INSERT INTO ${SCHEMAS.ops}.schema_migrations (filename) VALUES (?)`,
        [file]
      );
      logger.info(`[DB] Migración aplicada: ${file}`);
    }
  } finally {
    try {
      if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
    } finally {
      await conn.end();
    }
  }
}
