import { Router } from 'express';
import logger from '../../utils/logger.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import {
  listConstructionTypes, getConstructionTypeByName, getIngredients,
  createConstructionType, updateConstructionType, updateConstructionTypeIngredients,
  deleteConstructionType, configureConstructionUse, getUnlocksItemName,
} from '../../services/constructionTypeService.js';
import { runWorldIntegrityChecks } from '../../services/worldIntegrityService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

async function enrichConstructionType(t) {
  return {
    ...t,
    ingredients: await getIngredients(t.id),
    unlocks_item_name: await getUnlocksItemName(t.unlocks_recipe_id),
    image_url: t.image_filename ? buildAssetUrl(t.image_filename, '/api/construction-types') : null,
  };
}

export function createConstructionTypesRouter() {
  const router = Router();

  router.get('/api/construction-types', requireAuth, handler(async (req, res) => {
    const types = await listConstructionTypes();
    res.json(await Promise.all(types.map(enrichConstructionType)));
  }));

  router.post('/api/construction-types', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createConstructionType(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó el tipo de construcción "${created.name}"`);
    auditWeb(req, 'construction.create', created.name);
    res.status(201).json(await enrichConstructionType(created));
  }));

  router.patch('/api/construction-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateConstructionType(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó el tipo de construcción "${req.params.name}"`);
    auditWeb(req, 'construction.update', req.params.name, req.body);
    const { findings } = await runWorldIntegrityChecks({ scope: { entity: 'construction_type', entityName: updated.name } });
    res.json({ ...(await enrichConstructionType(updated)), warnings: findings });
  }));

  router.patch('/api/construction-types/:name/ingredients', requireRole('isRolepriest'), handler(async (req, res) => {
    const ingredients = await updateConstructionTypeIngredients(req.params.name, req.body?.ingredients ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó los ingredientes de "${req.params.name}"`);
    auditWeb(req, 'construction.update_ingredients', req.params.name, { ingredients });
    res.json({ ingredients });
  }));

  router.patch('/api/construction-types/:name/usar', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await configureConstructionUse(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} configuró la interacción activa de "${req.params.name}"`);
    auditWeb(req, 'construction.configure_use', req.params.name, req.body);
    res.json(updated);
  }));

  router.delete('/api/construction-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteConstructionType(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó el tipo de construcción "${req.params.name}"`);
    auditWeb(req, 'construction.delete', req.params.name);
    res.json(deleted);
  }));

  router.get('/api/construction-types/:name', requireAuth, handler(async (req, res) => {
    const type = await getConstructionTypeByName(req.params.name);
    if (!type) return res.status(404).json({ error: `No existe ningún tipo de construcción llamado "${req.params.name}".` });
    res.json(await enrichConstructionType(type));
  }));

  return router;
}
