import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  getTileWithDetails, updateTile, deleteTile, createTileRange,
  updateConstructionInstance, removeConstruction, MAX_RANGE_TILES,
} from '../../services/mapService.js';
import { getItemsAtTile } from '../../services/tileItemService.js';
import { addPointOfInterest, removePointOfInterest, getPointsOfInterest } from '../../services/poiService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';
import { getTilesInRegionCached, MAX_TILES_READ } from '../state/mapCache.js';

export function createTilesRouter() {
  const router = Router();

  router.get('/api/tiles', requireAuth, handler(async (req, res) => {
    const minX = parseInt(req.query.minX, 10);
    const maxX = parseInt(req.query.maxX, 10);
    const minY = parseInt(req.query.minY, 10);
    const maxY = parseInt(req.query.maxY, 10);
    if (![minX, maxX, minY, maxY].every(Number.isInteger)) {
      return res.status(400).json({ error: 'minX/maxX/minY/maxY deben ser enteros.' });
    }
    if (minX > maxX || minY > maxY) {
      return res.status(400).json({ error: 'minX debe ser ≤ maxX, y minY ≤ maxY.' });
    }
    const area = (maxX - minX + 1) * (maxY - minY + 1);
    if (area > MAX_TILES_READ) {
      return res.status(400).json({ error: `El área pedida (${area} casillas) supera el máximo de ${MAX_TILES_READ}.` });
    }
    const withMedia = req.query.withMedia !== 'false';
    const tiles = await getTilesInRegionCached(minX, minY, maxX, maxY, withMedia);
    res.json({ minX, maxX, minY, maxY, tiles });
  }));

  router.get('/api/tiles/detail', requireAuth, handler(async (req, res) => {
    const x = parseInt(req.query.x, 10);
    const y = parseInt(req.query.y, 10);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ error: 'x/y deben ser enteros.' });
    }
    const tile = await getTileWithDetails(x, y);
    if (!tile) return res.status(404).json({ error: `No existe ninguna casilla en (${x}, ${y}).` });
    res.json({ ...tile, tileItems: await getItemsAtTile(x, y) });
  }));

  router.patch('/api/tiles', requireAuth, handler(async (req, res) => {
    const { x, y, name, terrainType, description, resource_type, effectType } = req.body ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ error: 'x/y deben ser enteros.' });
    }
    const updated = await updateTile(x, y, { name, terrainType, description, resource_type, effectType });
    const changedFields = Object.keys(req.body).filter(k => k !== 'x' && k !== 'y');
    logger.info(`[MapServer] ${req.session.user.username} editó (${x},${y}): ${changedFields.join(', ')}`);
    auditWeb(req, 'tile.update', `(${x},${y})`, { changedFields });
    res.json(updated);
  }));

  router.delete('/api/tiles', requireAuth, handler(async (req, res) => {
    const { x, y } = req.body ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ error: 'x/y deben ser enteros.' });
    }
    const deleted = await deleteTile(x, y);
    logger.info(`[MapServer] ${req.session.user.username} borró la casilla "${deleted.name}" @ (${x},${y})`);
    auditWeb(req, 'tile.delete', `(${x},${y})`, { name: deleted.name });
    res.json({ ok: true });
  }));

  router.post('/api/pois', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x, y, name, description, emoji } = req.body ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ error: 'x/y deben ser enteros.' });
    }
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: '`name` es obligatorio.' });
    }
    const tile = await getTileWithDetails(x, y);
    if (!tile) return res.status(404).json({ error: `No existe ninguna casilla en (${x}, ${y}).` });

    const poi = await addPointOfInterest(tile.id, { name, description: description ?? null, emoji: emoji ?? '📍' });
    logger.info(`[MapServer] ${req.session.user.username} añadió el lugar de interés "${name}" en (${x},${y})`);
    auditWeb(req, 'tile.poi_add', `(${x},${y})`, { name });
    res.status(201).json(poi);
  }));

  router.delete('/api/pois/:id', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x, y } = req.body ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ error: 'x/y deben ser enteros.' });
    }
    const tile = await getTileWithDetails(x, y);
    if (!tile) return res.status(404).json({ error: `No existe ninguna casilla en (${x}, ${y}).` });

    const pois = await getPointsOfInterest(tile.id);
    const target = pois.find(p => p.id === parseInt(req.params.id, 10));
    if (!target) return res.status(404).json({ error: 'Ese lugar de interés ya no existe.' });

    const removed = await removePointOfInterest(tile.id, target.name);
    logger.info(`[MapServer] ${req.session.user.username} quitó el lugar de interés "${removed.name}" de (${x},${y})`);
    auditWeb(req, 'tile.poi_remove', `(${x},${y})`, { name: removed.name });
    res.json({ ok: true });
  }));

  router.patch('/api/constructions/:id', requireRole('isRolepriest'), handler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { currentHealth, fuelLevel, durability } = req.body ?? {};
    const updated = await updateConstructionInstance(id, { currentHealth, fuelLevel, durability });
    logger.info(`[MapServer] ${req.session.user.username} editó la construcción #${id}: vida=${updated.current_health}, combustible=${updated.fuel_level}, durabilidad=${updated.durability}`);
    auditWeb(req, 'tile.construction_update', `#${id} ${updated.name}`, { currentHealth, fuelLevel, durability });
    res.json(updated);
  }));

  router.delete('/api/constructions/:id', requireRole('isRolepriest'), handler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const removed = await removeConstruction(id);
    logger.info(`[MapServer] ${req.session.user.username} eliminó la construcción #${id} "${removed.name}"`);
    auditWeb(req, 'tile.construction_remove', `#${id} ${removed.name}`, {});
    res.json({ ok: true });
  }));

  router.post('/api/tiles/bulk', requireAuth, handler(async (req, res) => {
    const { tiles, updates } = req.body ?? {};
    if (!Array.isArray(tiles) || tiles.length === 0) {
      return res.status(400).json({ error: '`tiles` debe ser una lista de {x, y} no vacía.' });
    }
    if (tiles.length > MAX_RANGE_TILES) {
      return res.status(400).json({ error: `Máximo ${MAX_RANGE_TILES} casillas por llamada.` });
    }
    const results = [];
    const errors = [];
    for (const { x, y } of tiles) {
      try {
        await updateTile(x, y, updates ?? {});
        results.push({ x, y });
      } catch (err) {
        errors.push({ x, y, error: err.message });
      }
    }
    logger.info(`[MapServer] ${req.session.user.username} editó en bloque ${results.length} casilla(s) (${errors.length} error(es))`);
    auditWeb(req, 'tile.bulk_update', `${results.length} casilla(s)`, { updates, tileCount: tiles.length, errorCount: errors.length });
    res.json({ updated: results.length, errors });
  }));

  router.post('/api/tiles/range', requireAuth, handler(async (req, res) => {
    const { x1, y1, x2, y2, name, terrainType, description, resourceType } = req.body ?? {};
    if (![x1, y1, x2, y2].every(Number.isInteger)) {
      return res.status(400).json({ error: 'x1/y1/x2/y2 deben ser enteros.' });
    }
    if (!name || !terrainType) {
      return res.status(400).json({ error: '`name` y `terrainType` son obligatorios.' });
    }
    const result = await createTileRange(x1, y1, x2, y2, name, terrainType, description ?? '', resourceType ?? null);
    logger.info(`[MapServer] ${req.session.user.username} creó un rango de casillas: ${result.created} nueva(s), ${result.skipped} ya existían`);
    auditWeb(req, 'tile.range_create', `(${x1},${y1})-(${x2},${y2})`, { name, terrainType, created: result.created, skipped: result.skipped });
    res.json(result);
  }));

  return router;
}
