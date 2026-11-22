import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  listFactions, createFaction, updateFaction, deleteFaction, setOwner, getFactionByName,
  assignRange, unassignRange, hasConstructionTypeInRange,
} from '../../services/factionService.js';
import { getFactionRanks, getRankRequirements, setRankRequirement } from '../../services/permissionService.js';
import { PERMISSION_ACTIONS } from '../../utils/permissionActions.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

const AYUNTAMIENTO_TYPE_NAME = 'ayuntamiento';

export function createFactionsRouter() {
  const router = Router();

  router.get('/api/facciones', requireAuth, handler(async (req, res) => {
    res.json(await listFactions());
  }));

  router.post('/api/facciones', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createFaction(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó la facción "${created.name}"`);
    auditWeb(req, 'faccion.create', created.name);
    res.status(201).json(created);
  }));

  router.patch('/api/facciones/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateFaction(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó la facción "${req.params.name}"`);
    auditWeb(req, 'faccion.update', req.params.name, req.body);
    res.json(updated);
  }));

  router.patch('/api/facciones/:name/owner', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await setOwner(req.params.name, req.body?.discordId || null);
    logger.info(`[MapServer] ${req.session.user.username} cambió el dueño de la facción "${req.params.name}"`);
    auditWeb(req, 'faccion.set_owner', req.params.name, { discordId: req.body?.discordId || null });
    res.json(updated);
  }));

  router.delete('/api/facciones/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteFaction(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó la facción "${req.params.name}"`);
    auditWeb(req, 'faccion.delete', req.params.name, { tilesAffected: deleted.tilesAffected });
    res.json(deleted);
  }));

  router.post('/api/facciones/:name/assign-range', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x1, y1, x2, y2 } = req.body ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      return res.status(400).json({ error: 'x1/y1/x2/y2 deben ser enteros.' });
    }
    if (!(await hasConstructionTypeInRange(x1, y1, x2, y2, AYUNTAMIENTO_TYPE_NAME))) {
      return res.status(400).json({
        error: `No se puede asignar: no hay ningún edificio de tipo "${AYUNTAMIENTO_TYPE_NAME}" dentro de ese rectángulo. Colócalo primero (crea el tipo con /construction create si no existe, y plántalo con /build place) y vuelve a intentarlo.`,
      });
    }
    const result = await assignRange(x1, y1, x2, y2, req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} asignó "${req.params.name}" a ${result.tilesAssigned} casilla(s) en (${x1},${y1})-(${x2},${y2})`);
    auditWeb(req, 'faccion.assign_range', req.params.name, { x1, y1, x2, y2, tilesAssigned: result.tilesAssigned });
    res.json(result);
  }));

  router.get('/api/facciones/:name/ranks', requireAuth, handler(async (req, res) => {
    const faction = await getFactionByName(req.params.name);
    if (!faction) return res.status(404).json({ error: 'No existe esa facción.' });
    const [ranks, requirements] = await Promise.all([
      getFactionRanks(faction.id),
      getRankRequirements(faction.id),
    ]);
    res.json({ ranks, requirements, actions: PERMISSION_ACTIONS });
  }));

  router.patch('/api/facciones/:name/permisos', requireRole('isRolepriest'), handler(async (req, res) => {
    const faction = await getFactionByName(req.params.name);
    if (!faction) return res.status(404).json({ error: 'No existe esa facción.' });
    const { action, requiredRankOrder } = req.body ?? {};
    await setRankRequirement({ discordId: req.session.user.id, isRolepriest: true }, faction.id, action, requiredRankOrder);
    logger.info(`[MapServer] ${req.session.user.username} fijó "${action}" → rango ${requiredRankOrder} en "${faction.name}"`);
    auditWeb(req, 'faccion.set_rank_requirement', faction.name, { action, requiredRankOrder });
    res.json({ ok: true });
  }));

  router.post('/api/facciones/unassign-range', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x1, y1, x2, y2 } = req.body ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      return res.status(400).json({ error: 'x1/y1/x2/y2 deben ser enteros.' });
    }
    const result = await unassignRange(x1, y1, x2, y2);
    logger.info(`[MapServer] ${req.session.user.username} quitó la facción de ${result.tilesUnassigned} casilla(s) en (${x1},${y1})-(${x2},${y2})`);
    auditWeb(req, 'faccion.unassign_range', null, { x1, y1, x2, y2, tilesUnassigned: result.tilesUnassigned });
    res.json(result);
  }));

  return router;
}
