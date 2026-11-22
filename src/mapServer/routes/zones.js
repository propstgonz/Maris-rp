import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  listZones, getZoneByName, createZone, updateZone, deleteZone,
  getZoneResources, setZoneResources, assignRange, unassignRange,
} from '../../services/zoneService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';
import { refreshMapCache } from '../state/mapCache.js';
import { broadcastChange } from '../state/sse.js';

async function enrichZone(zone) {
  return { ...zone, resources: await getZoneResources(zone.id) };
}

async function republishMap(entityName) {
  await refreshMapCache();
  broadcastChange('map', 'zona', entityName);
}

export function createZonesRouter() {
  const router = Router();

  router.get('/api/zonas', requireAuth, handler(async (req, res) => {
    const zones = await listZones();
    res.json(await Promise.all(zones.map(enrichZone)));
  }));

  router.get('/api/zonas/:name', requireAuth, handler(async (req, res) => {
    const zone = await getZoneByName(req.params.name);
    if (!zone) return res.status(404).json({ error: `No existe ninguna zona llamada "${req.params.name}".` });
    res.json(await enrichZone(zone));
  }));

  router.post('/api/zonas', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createZone(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó la zona "${created.name}"`);
    auditWeb(req, 'zona.create', created.name, req.body);
    res.status(201).json(created);
  }));

  router.patch('/api/zonas/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateZone(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó la zona "${req.params.name}"`);
    auditWeb(req, 'zona.update', req.params.name, req.body);
    await republishMap(updated.name);
    res.json(updated);
  }));

  router.patch('/api/zonas/:name/resources', requireRole('isRolepriest'), handler(async (req, res) => {
    const resources = await setZoneResources(req.params.name, req.body?.resources ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó los recursos de la zona "${req.params.name}"`);
    auditWeb(req, 'zona.update_resources', req.params.name, { resources });
    res.json({ resources });
  }));

  router.delete('/api/zonas/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteZone(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó la zona "${req.params.name}"`);
    auditWeb(req, 'zona.delete', req.params.name);
    res.json(deleted);
  }));

  router.post('/api/zonas/:name/assign-range', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x1, y1, x2, y2 } = req.body ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      return res.status(400).json({ error: 'x1/y1/x2/y2 deben ser enteros.' });
    }
    const result = await assignRange(req.params.name, x1, y1, x2, y2);
    logger.info(`[MapServer] ${req.session.user.username} asignó la zona "${req.params.name}" a ${result.tilesAffected} casilla(s) en (${x1},${y1})-(${x2},${y2})`);
    auditWeb(req, 'zona.assign_range', req.params.name, { x1, y1, x2, y2, tilesAffected: result.tilesAffected });
    await republishMap(req.params.name);
    res.json(result);
  }));

  router.post('/api/zonas/unassign-range', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x1, y1, x2, y2 } = req.body ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      return res.status(400).json({ error: 'x1/y1/x2/y2 deben ser enteros.' });
    }
    const result = await unassignRange(x1, y1, x2, y2);
    logger.info(`[MapServer] ${req.session.user.username} quitó la zona de ${result.tilesAffected} casilla(s) en (${x1},${y1})-(${x2},${y2})`);
    auditWeb(req, 'zona.unassign_range', null, { x1, y1, x2, y2, tilesAffected: result.tilesAffected });
    await republishMap(null);
    res.json(result);
  }));

  return router;
}
