import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  listItemCategories, createItemCategory, updateItemCategory, deleteItemCategory,
} from '../../services/itemCategoryService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

export function createItemCategoriesRouter() {
  const router = Router();

  router.get('/api/item-categories', requireAuth, handler(async (req, res) => {
    res.json(await listItemCategories());
  }));

  router.post('/api/item-categories', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createItemCategory(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó la categoría de ítems "${created.name}"`);
    auditWeb(req, 'itemCategory.create', created.name);
    res.status(201).json(created);
  }));

  router.patch('/api/item-categories/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateItemCategory(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó la categoría de ítems "${req.params.name}"`);
    auditWeb(req, 'itemCategory.update', req.params.name, req.body);
    res.json(updated);
  }));

  router.delete('/api/item-categories/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteItemCategory(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó la categoría de ítems "${req.params.name}"`);
    auditWeb(req, 'itemCategory.delete', req.params.name);
    res.json(deleted);
  }));

  return router;
}
