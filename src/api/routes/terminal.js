import { Router } from 'express';
import logger from '../../utils/logger.js';
import { query } from '../../database/index.js';
import { enqueueCommand, getJobResult } from '../../services/terminalJobService.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

const TERMINAL_POLL_TIMEOUT_MS  = 10_000;
const TERMINAL_POLL_INTERVAL_MS = 300;

const SQL_ROW_LIMIT = 500;

export function createTerminalRouter({ terminalLimiter }) {
  const router = Router();

  router.post('/api/terminal/command', requireRole('isRolepriest'), terminalLimiter, handler(async (req, res) => {
    const commandLine = (req.body?.commandLine ?? '').trim();
    if (!commandLine) return res.status(400).json({ error: 'Escribe una línea de comando.' });

    const jobId = await enqueueCommand(commandLine, req.session.user.id);
    const deadline = Date.now() + TERMINAL_POLL_TIMEOUT_MS;

    let job = await getJobResult(jobId);
    while (job?.status === 'pending' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, TERMINAL_POLL_INTERVAL_MS));
      job = await getJobResult(jobId);
    }

    if (!job || job.status === 'pending') {
      return res.status(202).json({ error: 'El bot está tardando más de lo normal en responder (¿está reiniciándose?) — vuelve a intentarlo en un momento.' });
    }

    logger.info(`[API] ${req.session.user.username} ejecutó desde el terminal: "${commandLine}" → ${job.status}`);
    auditWeb(req, 'terminal.command', commandLine, { status: job.status });

    if (job.status === 'error') return res.status(400).json({ error: job.result_text });
    res.json({ output: job.result_text });
  }));

  router.post('/api/terminal/sql', requireRole('isRolepriest'), terminalLimiter, async (req, res) => {
    const sqlText = (req.body?.query ?? '').trim();
    if (!sqlText) return res.status(400).json({ error: 'Escribe una consulta SQL.' });
    if (!/^select\s/i.test(sqlText)) {
      return res.status(400).json({ error: 'Solo se permiten consultas SELECT — este terminal es de solo lectura.' });
    }

    try {
      const rows = await query(sqlText);
      const truncated = rows.length > SQL_ROW_LIMIT;
      logger.info(`[API] ${req.session.user.username} ejecutó SQL desde el terminal (${rows.length} fila(s)): ${sqlText}`);
      auditWeb(req, 'terminal.sql', sqlText, { rowCount: rows.length });
      res.json({ rows: rows.slice(0, SQL_ROW_LIMIT), totalRows: rows.length, truncated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
