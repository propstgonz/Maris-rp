import { Router } from 'express';
import logger from '../../utils/logger.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import {
  listItems, createItem, updateItem, deleteItem,
  configureItemWeapon, configureItemVehicle, getItemByName,
} from '../../services/itemService.js';
import {
  addRecipe, getRecipesForItem, getRecipeById, removeRecipe,
} from '../../services/recipeService.js';
import { getConstructionTypeByName } from '../../services/constructionTypeService.js';
import { runWorldIntegrityChecks } from '../../services/worldIntegrityService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

export function createItemsRouter() {
  const router = Router();

  router.get('/api/items', requireAuth, handler(async (req, res) => {
    const items = await listItems();
    res.json(items.map(item => ({
      ...item,
      image_url: item.image_filename ? buildAssetUrl(item.image_filename, '/api/items') : null,
    })));
  }));

  router.post('/api/items', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createItem(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó el ítem "${created.name}"`);
    auditWeb(req, 'item.create', created.name, { itemType: created.item_type });
    res.status(201).json(created);
  }));

  router.patch('/api/items/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateItem(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó el ítem "${req.params.name}"`);
    auditWeb(req, 'item.update', req.params.name, req.body);
    const { findings } = await runWorldIntegrityChecks({ scope: { entity: 'item', entityName: updated.name } });
    res.json({ ...updated, warnings: findings });
  }));

  router.patch('/api/items/:name/arma', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await configureItemWeapon(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} configuró el arma "${req.params.name}"`);
    auditWeb(req, 'item.configure_weapon', req.params.name, req.body);
    res.json(updated);
  }));

  router.patch('/api/items/:name/vehiculo', requireRole('isRolepriest'), handler(async (req, res) => {
    const speedMultiplier = req.body?.speedMultiplier ?? 1;
    const updated = await configureItemVehicle(req.params.name, req.body?.category, speedMultiplier);
    logger.info(`[MapServer] ${req.session.user.username} configuró el vehículo "${req.params.name}"`);
    auditWeb(req, 'item.configure_vehicle', req.params.name, { category: req.body?.category, speedMultiplier });
    res.json(updated);
  }));

  router.delete('/api/items/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteItem(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó el ítem "${req.params.name}"`);
    auditWeb(req, 'item.delete', req.params.name);
    res.json(deleted);
  }));

  router.get('/api/items/:name/recipes', requireAuth, handler(async (req, res) => {
    const item = await getItemByName(req.params.name);
    if (!item) return res.status(404).json({ error: `No existe ningún ítem llamado "${req.params.name}".` });
    res.json(await getRecipesForItem(item.id));
  }));

  router.post('/api/items/:name/recipes', requireRole('isRolepriest'), handler(async (req, res) => {
    const item = await getItemByName(req.params.name);
    if (!item) return res.status(404).json({ error: `No existe ningún ítem llamado "${req.params.name}".` });

    const { ingredients = [], laboroCost = 0, constructionType = null, toolItemName = null, toolLaburoReduction = null } = req.body ?? {};

    if (constructionType && !(await getConstructionTypeByName(constructionType))) {
      return res.status(400).json({ error: `No existe ningún tipo de construcción llamado "${constructionType}".` });
    }

    let toolItemId = null;
    if (toolItemName) {
      const toolItem = await getItemByName(toolItemName);
      if (!toolItem) return res.status(400).json({ error: `El ítem "${toolItemName}" (herramienta) no existe en el catálogo.` });
      if (toolLaburoReduction == null) {
        return res.status(400).json({ error: 'Si eliges una herramienta que abarata el Laburo, hace falta indicar cuánto lo abarata.' });
      }
      toolItemId = toolItem.id;
    }

    const hasRecipe = ingredients.length > 0 || laboroCost > 0 || Boolean(constructionType);
    if (!hasRecipe) {
      return res.status(400).json({ error: 'No hay ni ingredientes, ni coste de Laburo, ni construcción — no hay ninguna receta que añadir.' });
    }

    const recipeId = await addRecipe(item.id, {
      resultQty: 1, laboroCost, constructionType, ingredients, toolItemId, toolLaburoReduction,
    });
    logger.info(`[MapServer] ${req.session.user.username} añadió la receta #${recipeId} de "${req.params.name}"`);
    auditWeb(req, 'item.add_recipe', req.params.name, { recipeId });
    res.status(201).json(await getRecipeById(recipeId));
  }));

  router.delete('/api/recipes/:id', requireRole('isRolepriest'), handler(async (req, res) => {
    const recipeId = parseInt(req.params.id, 10);
    const removed = await removeRecipe(recipeId);
    if (removed === 0) return res.status(404).json({ error: `No existe ninguna receta con ID ${recipeId}.` });
    logger.info(`[MapServer] ${req.session.user.username} quitó la receta #${recipeId}`);
    auditWeb(req, 'item.remove_recipe', String(recipeId));
    res.json({ ok: true });
  }));

  return router;
}
