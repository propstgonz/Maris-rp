import { Router } from 'express';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, basename } from 'path';
import logger from '../../utils/logger.js';
import { getBackupConfig, runBackup, getBackupCron, setBackupCron, listBackups, isBackupFilename } from '../../services/backupService.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

export function createBackupsRouter() {
  const router = Router();
  const { backupDir } = getBackupConfig();

  router.get('/api/backups', requireRole('isRolepriest'), handler(async (req, res) => {
    res.json(listBackups());
  }));

  router.get('/api/backups/schedule', requireRole('isRolepriest'), handler(async (req, res) => {
    res.json({ cron: await getBackupCron() });
  }));

  router.put('/api/backups/schedule', requireRole('isRolepriest'), handler(async (req, res) => {
    const cron = (req.body?.cron ?? '').trim();
    if (!cron) return res.status(400).json({ error: '`cron` es obligatorio.' });
    try {
      await setBackupCron(cron);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    logger.info(`[API] ${req.session.user.username} cambió el horario de backup a "${cron}"`);
    auditWeb(req, 'backup.set_schedule', null, { cron });
    res.json({ cron });
  }));

  router.post('/api/backups/run', requireRole('isRolepriest'), handler(async (req, res) => {
    const result = await runBackup();
    logger.info(`[API] ${req.session.user.username} generó una copia de seguridad manual`);
    auditWeb(req, 'backup.run_now', null, {
      sizeBytes: result.sizeBytes,
      bucketIncluded: result.bucketIncluded,
    });
    res.json({ filename: result.filename, sizeBytes: result.sizeBytes });
  }));

  router.get('/api/backups/:filename', requireRole('isRolepriest'), handler(async (req, res) => {
    const filename = basename(req.params.filename);
    if (!isBackupFilename(filename)) {
      return res.status(400).json({ error: 'Nombre de fichero de backup inválido.' });
    }

    const filePath = join(backupDir, filename);
    try {
      await stat(filePath);
    } catch {
      return res.status(404).json({ error: `No existe ningún backup llamado "${filename}".` });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', filename.endsWith('.zip') ? 'application/zip' : 'application/gzip');
    createReadStream(filePath)
      .on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Error leyendo el fichero de backup.' }); })
      .pipe(res);
  }));

  return router;
}
