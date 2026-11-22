import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  listTerrainTypes, getTerrainTypeByName, createTerrainType, updateTerrainType, deleteTerrainType,
  getResources, setTerrainResources,
} from '../../services/terrainTypeService.js';
import { runWorldIntegrityChecks } from '../../services/worldIntegrityService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

async function enrichTerrainType(t) {
  return { ...t, resources: await getResources(t.id) };
}

export function createTerrainTypesRouter() {
  const router = Router();

  router.get('/api/terrain-types', requireAuth, handler(async (req, res) => {
    const types = await listTerrainTypes();
    res.json(await Promise.all(types.map(enrichTerrainType)));
  }));

  router.get('/api/terrain-types/:name', requireAuth, handler(async (req, res) => {
    const type = await getTerrainTypeByName(req.params.name);
    if (!type) return res.status(404).json({ error: `No existe ningún tipo de terreno llamado "${req.params.name}".` });
    res.json(await enrichTerrainType(type));
  }));

  router.patch('/api/terrain-types/:name/resources', requireRole('isRolepriest'), handler(async (req, res) => {
    const resources = await setTerrainResources(req.params.name, req.body?.resources ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó los recursos de "${req.params.name}"`);
    auditWeb(req, 'terrain.update_resources', req.params.name, { resources });
    res.json({ resources });
  }));

  router.post('/api/terrain-types', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createTerrainType(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó el terreno "${created.name}"`);
    auditWeb(req, 'terrain.create', created.name, req.body);
    res.status(201).json(created);
  }));

  router.patch('/api/terrain-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateTerrainType(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó el terreno "${req.params.name}"`);
    auditWeb(req, 'terrain.update', req.params.name, req.body);
    const { findings } = await runWorldIntegrityChecks({ scope: { entity: 'terrain_type', entityName: updated.name } });
    res.json({ ...updated, warnings: findings });
  }));

  router.delete('/api/terrain-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteTerrainType(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó el terreno "${req.params.name}"`);
    auditWeb(req, 'terrain.delete', req.params.name);
    res.json(deleted);
  }));

  return router;
}
