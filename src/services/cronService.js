import cron   from 'node-cron';
import logger from '../utils/logger.js';
import { runBackup, getBackupCron } from './backupService.js';
import { pruneExpiredCharacters } from './characterLifecycleService.js';
import { pruneOldAuditLog } from './auditLogService.js';
import { pruneOldTerminalJobs } from './terminalJobService.js';
import { pruneOldBotJobs } from './botJobService.js';

const runningJobs = new Set();

function guardedJob(name, fn) {
  return async () => {
    if (runningJobs.has(name)) {
      logger.warn(`[Cron] "${name}" seguía en marcha cuando tocaba disparar de nuevo — se salta esta vez.`);
      return;
    }
    runningJobs.add(name);
    try {
      await fn();
    } finally {
      runningJobs.delete(name);
    }
  };
}

function scheduleDaily(label, expr, name, fn) {
  cron.schedule(expr, guardedJob(name, async () => {
    try {
      await fn();
    } catch (err) {
      logger.error(`[Cron ${label}] Error no capturado: ${err.message}`);
      console.error(err);
    }
  }), { timezone: 'UTC' });
  logger.info(`[Cron] ✔ Job de ${label} registrado → "${expr}" (UTC)`);
}

const BACKUP_RECHECK_INTERVAL_MS = 60 * 1000;
let currentBackupCronExpr = null;
let currentBackupTask = null;

function armBackupJob(expr) {
  if (!cron.validate(expr)) {
    logger.error(`[Cron] Expresión de backup inválida: "${expr}" — se mantiene la anterior.`);
    return;
  }
  if (currentBackupTask) currentBackupTask.stop();
  currentBackupCronExpr = expr;
  currentBackupTask = cron.schedule(expr, guardedJob('backup', async () => {
    try {
      await runBackup();
    } catch (err) {
      logger.error(`[Backup] Falló el backup programado: ${err.message}. Revisa espacio en disco y permisos del directorio de datos cuanto antes.`);
    }
  }), { timezone: 'UTC' });
  logger.info(`[Cron] ✔ Job de backup (re)programado → "${expr}" (UTC)`);
}

async function scheduleBackupJob() {
  armBackupJob(await getBackupCron());
  setInterval(async () => {
    const latest = await getBackupCron();
    if (latest !== currentBackupCronExpr) armBackupJob(latest);
  }, BACKUP_RECHECK_INTERVAL_MS);
}

export async function startCronJobs(client) {
  runBackup().catch(err => {
    logger.error(`[Backup] Falló el backup de arranque: ${err.message}. Revisa espacio en disco y permisos del directorio de datos cuanto antes.`);
  });

  await scheduleBackupJob();

  scheduleDaily('muerte definitiva de personajes con la gracia vencida', '30 0 * * *', 'characterPrune', async () => {
    const cleaned = await pruneExpiredCharacters(client);
    if (cleaned > 0) logger.info(`[Cron] 🗑️ ${cleaned} personaje(s) con la gracia vencida pasaron a muerte definitiva.`);
  });

  scheduleDaily('purga del registro de acciones', '0 1 * * *', 'auditPrune', async () => {
    const removed = await pruneOldAuditLog(30);
    if (removed > 0) logger.info(`[Cron] 🗑️ ${removed} entrada(s) del registro de acciones (más de 30 días) eliminada(s).`);
  });

  scheduleDaily('purga de trabajos del terminal web', '5 1 * * *', 'terminalPrune', async () => {
    const removed = await pruneOldTerminalJobs();
    if (removed > 0) logger.info(`[Cron] 🗑️ ${removed} trabajo(s) del terminal web (más de 1 día) eliminado(s).`);
  });

  scheduleDaily('purga de bot_jobs', '6 1 * * *', 'botJobsPrune', async () => {
    const removed = await pruneOldBotJobs();
    if (removed > 0) logger.info(`[Cron] 🗑️ ${removed} job(s) de bot_jobs (más de 1 día) eliminado(s).`);
  });
}
