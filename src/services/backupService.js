import { readdirSync, unlinkSync, statSync, existsSync, mkdirSync, rmSync, createWriteStream } from 'fs';
import { join, dirname, basename } from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import cron from 'node-cron';
import { SCHEMAS } from '../database/tables.js';
import { getSetting, setSetting } from './settingsService.js';
import logger from '../utils/logger.js';

const BACKUP_DIR = process.env.BACKUP_DIR ?? join(process.cwd(), 'data', 'backups');

const BUCKET_DIR = process.env.BUCKET_DIR ?? '/app/bucket';

const RETENTION = (() => {
  const n = Number(process.env.BACKUP_RETENTION);
  return Number.isInteger(n) && n > 0 ? n : 7;
})();

const FILE_PREFIX = 'roleplay-';
const ARCHIVE_SUFFIX = '.zip';
const LEGACY_DB_SUFFIX = '.sql.gz';
const LEGACY_BUCKET_SUFFIX = '-bucket.tar.gz';

const DB_ENTRY_NAME = 'database.sql';

const MIN_VALID_DB_DUMP_BYTES = 1024;

function removeIfExists(path) {
  if (existsSync(path)) unlinkSync(path);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function classifyBackupFile(filename) {
  if (!filename.startsWith(FILE_PREFIX)) return null;
  if (filename.endsWith(ARCHIVE_SUFFIX)) {
    return { kind: 'full', timestamp: filename.slice(0, -ARCHIVE_SUFFIX.length) };
  }
  if (filename.endsWith(LEGACY_BUCKET_SUFFIX)) {
    return { kind: 'legacy-bucket', timestamp: filename.slice(0, -LEGACY_BUCKET_SUFFIX.length) };
  }
  if (filename.endsWith(LEGACY_DB_SUFFIX)) {
    return { kind: 'legacy-db', timestamp: filename.slice(0, -LEGACY_DB_SUFFIX.length) };
  }
  return null;
}

function scanBackups() {
  let names;
  try {
    names = readdirSync(BACKUP_DIR);
  } catch {
    return [];
  }

  const found = [];
  for (const filename of names) {
    const meta = classifyBackupFile(filename);
    if (!meta) continue;
    const path = join(BACKUP_DIR, filename);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    found.push({ filename, path, ...meta, sizeBytes: stats.size, mtimeMs: stats.mtimeMs });
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function listBackups() {
  return scanBackups().map(({ filename, kind, sizeBytes, mtimeMs }) => ({
    filename,
    kind,
    sizeBytes,
    createdAt: new Date(mtimeMs).toISOString(),
  }));
}

export function isBackupFilename(filename) {
  return classifyBackupFile(filename) !== null;
}

function pruneOldBackups() {
  const byTimestamp = new Map();
  for (const entry of scanBackups()) {
    const unit = byTimestamp.get(entry.timestamp) ?? { newestMtime: 0, files: [] };
    unit.newestMtime = Math.max(unit.newestMtime, entry.mtimeMs);
    unit.files.push(entry);
    byTimestamp.set(entry.timestamp, unit);
  }

  const units = [...byTimestamp.values()].sort((a, b) => b.newestMtime - a.newestMtime);
  const toDelete = units.slice(RETENTION);

  let deleted = 0;
  for (const unit of toDelete) {
    for (const file of unit.files) {
      try {
        unlinkSync(file.path);
        deleted++;
        logger.debug(`[Backup] Backup antiguo eliminado: ${file.filename}`);
      } catch (err) {
        logger.warn(`[Backup] No se pudo eliminar el backup antiguo "${file.filename}": ${err.message}`);
      }
    }
  }

  if (deleted > 0) {
    logger.info(
      `[Backup] Rotación: ${toDelete.length} copia(s) antigua(s) eliminada(s) (${deleted} fichero(s)), ` +
      `${Math.min(units.length, RETENTION)} conservada(s) (retención: ${RETENTION}).`
    );
  }
}

async function runMysqldump(destPath) {
  const args = [
    `--host=${process.env.DB_HOST ?? '127.0.0.1'}`,
    `--port=${process.env.DB_PORT ?? 3306}`,
    `--user=${process.env.DB_USER ?? 'root'}`,
    `--password=${process.env.DB_PASSWORD ?? ''}`,

    '--ssl=0',
    '--single-transaction',
    '--routines',
    '--triggers',
    '--databases',
    ...Object.values(SCHEMAS),
  ];

  const dump = spawn('mysqldump', args);
  const out = createWriteStream(destPath);

  let stderr = '';
  dump.stderr.on('data', chunk => { stderr += chunk; });

  const exitPromise = new Promise((resolve, reject) => {
    dump.on('error', reject);
    dump.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`mysqldump salió con código ${code}: ${stderr}`));
    });
  });

  const [piped, exited] = await Promise.allSettled([pipeline(dump.stdout, out), exitPromise]);
  if (exited.status === 'rejected') throw exited.reason;
  if (piped.status === 'rejected') throw piped.reason;
}

function runZip(archivePath, cwd, entryName) {
  return new Promise((resolve, reject) => {
    const zip = spawn('zip', ['-q', '-r', archivePath, entryName], { cwd });
    let stderr = '';
    zip.stderr.on('data', chunk => { stderr += chunk; });
    zip.on('error', reject);
    zip.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`zip salió con código ${code}: ${stderr}`));
    });
  });
}

export async function runBackup() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  const ts = timestamp();
  const filename = `${FILE_PREFIX}${ts}${ARCHIVE_SUFFIX}`;
  const archivePath = join(BACKUP_DIR, filename);
  const stagingDir = join(BACKUP_DIR, `.staging-${ts}`);
  const dumpPath = join(stagingDir, DB_ENTRY_NAME);

  let bucketIncluded = false;
  try {
    mkdirSync(stagingDir, { recursive: true });
    await runMysqldump(dumpPath);

    const dumpSizeBytes = statSync(dumpPath).size;
    if (dumpSizeBytes < MIN_VALID_DB_DUMP_BYTES) {
      throw new Error(`El volcado de la base de datos salió de ${dumpSizeBytes} bytes — se descarta por sospechosamente pequeño en vez de guardarlo como si fuera una copia real.`);
    }

    await runZip(archivePath, stagingDir, DB_ENTRY_NAME);

    if (existsSync(BUCKET_DIR)) {
      try {
        await runZip(archivePath, dirname(BUCKET_DIR), basename(BUCKET_DIR));
        bucketIncluded = true;
      } catch (err) {
        logger.warn(`[Backup] No se pudo añadir el bucket de imágenes a la copia: ${err.message}`);
      }
    } else {
      logger.debug(`[Backup] "${BUCKET_DIR}" no existe — la copia se queda solo con la base de datos (¿montaje no configurado en este entorno?).`);
    }
  } catch (err) {
    removeIfExists(archivePath);
    throw err;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }

  const sizeBytes = statSync(archivePath).size;
  logger.info(
    `[Backup] Copia creada: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB) — ` +
    (bucketIncluded ? 'base de datos + bucket de imágenes.' : 'solo base de datos.')
  );

  pruneOldBackups();

  return { archivePath, filename, sizeBytes, bucketIncluded };
}

export function getBackupConfig() {
  return { backupDir: BACKUP_DIR, retention: RETENTION };
}

const BACKUP_CRON_KEY = 'backup_cron';

const DEFAULT_BACKUP_CRON = process.env.BACKUP_CRON ?? '30 23 * * *';

export async function getBackupCron() {
  return getSetting(BACKUP_CRON_KEY, DEFAULT_BACKUP_CRON);
}

export async function setBackupCron(cronExpr) {
  if (!cron.validate(cronExpr)) {
    throw new Error(`"${cronExpr}" no es una expresión cron válida.`);
  }
  await setSetting(BACKUP_CRON_KEY, cronExpr);
}
