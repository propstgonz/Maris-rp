
import { Router } from 'express';
import { listRecentActions, listDistinctActions } from '../../services/auditLogService.js';
import { requireAuth } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';

export function createAuditLogRouter() {
  const router = Router();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const asDate = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : null);

  router.get('/api/audit-log', requireAuth, handler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json(await listRecentActions({
      page,
      pageSize: 50,
      actorDiscordId: req.query.actor  || null,
      action:         req.query.action || null,
      source:         req.query.source || null,
      prefix:         req.query.prefix || null,
      from:           asDate(req.query.from),
      to:             asDate(req.query.to),
      q:              req.query.q || null,
    }));
  }));

  router.get('/api/audit-log/actions', requireAuth, handler(async (req, res) => {
    res.json(await listDistinctActions());
  }));

  return router;
}
