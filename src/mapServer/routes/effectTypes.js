




import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  listEffectTypes, createEffectType, updateEffectType, deleteEffectType,
} from '../../services/effectTypesService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

export function createEffectTypesRouter() {
  const router = Router();

  router.get('/api/effect-types', requireAuth, handler(async (req, res) => {
    res.json(await listEffectTypes());
  }));

  router.post('/api/effect-types', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createEffectType(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó el estado "${created.name}"`);
    auditWeb(req, 'effect.create', created.name);
    res.status(201).json(created);
  }));

  router.patch('/api/effect-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateEffectType(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó el estado "${req.params.name}"`);
    auditWeb(req, 'effect.update', req.params.name, req.body);
    res.json(updated);
  }));

  router.delete('/api/effect-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteEffectType(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó el estado "${req.params.name}"`);
    auditWeb(req, 'effect.delete', req.params.name);
    res.json(deleted);
  }));

  return router;
}
