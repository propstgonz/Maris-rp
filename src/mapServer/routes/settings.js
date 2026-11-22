import { Router } from 'express';
import logger from '../../utils/logger.js';
import { getSpawnCoords, setSpawnCoords } from '../../services/playerService.js';
import { getMapMaxCoordinate, setMapMaxCoordinate } from '../../services/mapService.js';
import { getCharacterCreationCooldownHours, setCharacterCreationCooldownHours } from '../../services/characterLifecycleService.js';
import { getDayAmount as getLaburoDayAmount, setDayAmount as setLaburoDayAmount } from '../../services/laburoService.js';
import { getSetting, setSetting } from '../../services/settingsService.js';
import { getAttackLimits, setAttackLimits } from '../../services/combatService.js';
import { getGatherCooldownHours, setGatherCooldownHours } from '../../services/resourceGatherService.js';
import {
  getWorldTemperatureRange, setWorldTemperatureRange, regenerateWholeMapTemperatures,
} from '../../services/temperatureService.js';
import { requireAuth, requireRole, getIdleLogoutMinutes, setIdleLogoutMinutes } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';
import { broadcastChange } from '../state/sse.js';

async function getMechanicsSettings() {
  const attackLimits = await getAttackLimits();
  const worldTemperature = await getWorldTemperatureRange();
  return {
    moveFreedom: (await getSetting('move_freedom', 'true')) !== 'false',
    characterCreationCooldownHours: await getCharacterCreationCooldownHours(),
    laburoDayAmount: await getLaburoDayAmount(),

    attackMaxPerDay: attackLimits.maxPerDay,
    attackCooldownHours: attackLimits.cooldownHours,
    idleLogoutMinutes: await getIdleLogoutMinutes(),
    gatherCooldownHours: await getGatherCooldownHours(),
    mapMaxCoordinate: await getMapMaxCoordinate(),
    worldTempMin: worldTemperature.tempMin,
    worldTempMax: worldTemperature.tempMax,
  };
}

export function createSettingsRouter() {
  const router = Router();

  router.get('/api/settings/spawn', requireAuth, handler(async (req, res) => {
    res.json(await getSpawnCoords());
  }));

  router.patch('/api/settings/spawn', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x, y } = req.body ?? {};
    await setSpawnCoords(x, y);
    logger.info(`[MapServer] ${req.session.user.username} cambió la casilla de aparición a (${x},${y})`);
    auditWeb(req, 'settings.spawn', `(${x},${y})`, { x, y });
    res.json(await getSpawnCoords());
  }));

  router.get('/api/settings/mechanics', requireAuth, handler(async (req, res) => {
    res.json(await getMechanicsSettings());
  }));

  router.patch('/api/settings/mechanics', requireRole('isRolepriest'), handler(async (req, res) => {
    const {
      moveFreedom, characterCreationCooldownHours, laburoDayAmount,
      attackMaxPerDay, attackCooldownHours, idleLogoutMinutes, gatherCooldownHours, mapMaxCoordinate,
      worldTempMin, worldTempMax,
    } = req.body ?? {};

    if (moveFreedom !== undefined) {
      await setSetting('move_freedom', moveFreedom ? 'true' : 'false');
    }
    if (characterCreationCooldownHours !== undefined) {
      await setCharacterCreationCooldownHours(Number(characterCreationCooldownHours));
    }
    if (laburoDayAmount !== undefined) {
      await setLaburoDayAmount(Number(laburoDayAmount));
    }
    if (attackMaxPerDay !== undefined || attackCooldownHours !== undefined) {
      await setAttackLimits({
        maxPerDay: attackMaxPerDay !== undefined ? Number(attackMaxPerDay) : undefined,
        cooldownHours: attackCooldownHours !== undefined ? Number(attackCooldownHours) : undefined,
      });
    }
    if (idleLogoutMinutes !== undefined) {
      await setIdleLogoutMinutes(Number(idleLogoutMinutes));
    }
    if (gatherCooldownHours !== undefined) {
      await setGatherCooldownHours(Number(gatherCooldownHours));
    }
    if (mapMaxCoordinate !== undefined) {
      await setMapMaxCoordinate(Number(mapMaxCoordinate));
    }
    if (worldTempMin !== undefined || worldTempMax !== undefined) {
      const current = await getWorldTemperatureRange();
      await setWorldTemperatureRange(
        worldTempMin !== undefined ? Number(worldTempMin) : current.tempMin,
        worldTempMax !== undefined ? Number(worldTempMax) : current.tempMax
      );
      await regenerateWholeMapTemperatures();
      broadcastChange('map', 'tile', null);
    }

    const updated = await getMechanicsSettings();
    logger.info(`[MapServer] ${req.session.user.username} actualizó Mecánicas: ${JSON.stringify(req.body)}`);
    auditWeb(req, 'settings.mechanics', null, req.body);
    res.json(updated);
  }));

  router.post('/api/settings/temperatures/regenerate', requireRole('isRolepriest'), handler(async (req, res) => {
    const reroll = Boolean(req.body?.reroll);
    const tilesAffected = await regenerateWholeMapTemperatures({ reroll });
    broadcastChange('map', 'tile', null);
    logger.info(`[MapServer] ${req.session.user.username} recalculó la temperatura de ${tilesAffected} casilla(s)${reroll ? ' con semilla nueva' : ''}`);
    auditWeb(req, 'tile.temperatures', null, { tilesAffected, reroll });
    res.json({ tilesAffected, reroll });
  }));

  return router;
}
