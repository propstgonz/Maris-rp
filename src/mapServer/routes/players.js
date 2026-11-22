import { Router } from 'express';
import logger from '../../utils/logger.js';
import { MAX_HP, MAX_HUNGER } from '../../utils/permissions.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import {
  getPlayerStats, searchPlayersByUsername, setImmortal, revivePlayer, updateStats,
  applyEffect, removeEffect,
} from '../../services/playerService.js';
import { updateCharacterIdentity } from '../../services/characterLifecycleService.js';
import { getEffectType } from '../../services/effectTypesService.js';
import { enqueueJob, getJobResult } from '../../services/botJobService.js';
import {
  earnLaburo, spendLaburo, adminSetLaburo, getAvailableLaburo,
} from '../../services/laburoService.js';
import { getInventory, addItem, removeItem, setItemQuantity, setInventorySlotOrder } from '../../services/inventoryService.js';
import { listRecentActions } from '../../services/auditLogService.js';
import { listTransactionsForPlayer } from '../../services/tradeService.js';
import { mergePlayerActivity } from '../utils/mergeActivity.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';

export function createPlayersRouter() {
  const router = Router();

  router.get('/api/players/search', requireRole('isRolepriest'), handler(async (req, res) => {
    const q = (req.query.q ?? '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json(await searchPlayersByUsername(q, { page, pageSize: 10 }));
  }));

  router.get('/api/players/:discordId', requireRole('isRolepriest'), handler(async (req, res) => {
    const player = await getPlayerStats(req.params.discordId);
    if (!player) return res.status(404).json({ error: 'No se encontraron datos de ese jugador.' });

    const effects = await Promise.all(player.effects.map(async e => ({ ...e, meta: await getEffectType(e.effect_type) })));
    const inventory = await getInventory(req.params.discordId);

    const auditRows = (await listRecentActions({ actorDiscordId: req.params.discordId, pageSize: 30 })).rows;
    const transactionRows = (await listTransactionsForPlayer(req.params.discordId, { pageSize: 30 })).rows;
    const activity = mergePlayerActivity(auditRows, transactionRows, req.params.discordId, 30);
    res.json({ ...player, effects, inventory, activity, avatar_url: getAvatarUrl(player, '/api/players/:discordId') });
  }));

  router.post('/api/players/:discordId/kill', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const reason = (req.body?.reason || '').trim() || 'eliminado por Staff';

    const jobId = await enqueueJob('player.kill', { discordId, reason }, req.session.user.id);
    const deadline = Date.now() + 10_000;

    let job = await getJobResult(jobId);
    while (job?.status === 'pending' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
      job = await getJobResult(jobId);
    }

    if (!job || job.status === 'pending') {
      return res.status(202).json({ error: 'El bot está tardando más de lo normal en responder (¿está reiniciándose?) — vuelve a intentarlo en un momento.' });
    }
    if (job.status === 'error') {
      return res.status(400).json({ error: job.result_text });
    }

    const updated = JSON.parse(job.result_text);
    logger.info(`[MapServer] ${req.session.user.username} mató (PERMADEATH) a ${discordId} — motivo: ${reason}`);
    auditWeb(req, 'player.kill', discordId, { reason });
    res.json(updated);
  }));

  router.post('/api/players/:discordId/finalize', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const jobId = await enqueueJob('player.finalize_grace', { discordId }, req.session.user.id);
    const deadline = Date.now() + 10_000;

    let job = await getJobResult(jobId);
    while (job?.status === 'pending' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
      job = await getJobResult(jobId);
    }

    if (!job || job.status === 'pending') {
      return res.status(202).json({ error: 'El bot está tardando más de lo normal en responder (¿está reiniciándose?) — vuelve a intentarlo en un momento.' });
    }
    if (job.status === 'error') {
      return res.status(400).json({ error: job.result_text });
    }

    const updated = JSON.parse(job.result_text);
    logger.info(`[MapServer] ${req.session.user.username} finalizó (PERMADEATH) el periodo de gracia de ${discordId}`);
    auditWeb(req, 'player.kill', discordId, { finalizedFromGrace: true });
    res.json(updated);
  }));

  router.post('/api/players/:discordId/revive', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const hp = Number.isFinite(req.body?.hp) ? req.body.hp : MAX_HP;
    const updated = await revivePlayer(discordId, hp, MAX_HUNGER);
    logger.info(`[MapServer] ${req.session.user.username} revivió a ${discordId} con ${updated.hp} HP`);
    auditWeb(req, 'player.revive', discordId, { hp: updated.hp });
    res.json(updated);
  }));

  router.post('/api/players/:discordId/immortal', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const updated = await setImmortal(discordId, Boolean(req.body?.immortal));
    logger.info(`[MapServer] ${req.session.user.username} puso inmortal:${Boolean(req.body?.immortal)} a ${discordId}`);
    auditWeb(req, 'player.set_immortal', discordId, { immortal: Boolean(req.body?.immortal) });
    res.json(updated);
  }));

  router.patch('/api/players/:discordId/stats', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const before = await getPlayerStats(discordId);
    if (!before) return res.status(404).json({ error: 'No se encontraron datos de ese jugador.' });

    const { hp, hunger, laburo_base } = req.body ?? {};
    const updates = {};
    if (hp !== undefined) {
      updates.hp = (Boolean(before.is_immortal) && hp <= 0) ? 1 : hp;
    }
    if (hunger !== undefined) updates.hunger = hunger;
    if (laburo_base !== undefined) updates.laburo_base = laburo_base;
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Debes especificar al menos un campo (hp, hunger, laburo_base).' });
    }

    let updated;
    try {
      updated = await updateStats(discordId, updates);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let diedNow = false;
    if (updates.hp !== undefined && updated.hp <= 0 && before.is_alive) {
      const reason = `vida reducida a 0 por Staff (web, ${req.session.user.username})`;
      const jobId = await enqueueJob('player.stats_death', { discordId, reason }, req.session.user.id);
      const deadline = Date.now() + 10_000;

      let job = await getJobResult(jobId);
      while (job?.status === 'pending' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 300));
        job = await getJobResult(jobId);
      }

      if (!job || job.status === 'pending') {
        return res.status(202).json({ error: 'El bot está tardando más de lo normal en responder (¿está reiniciándose?) — la vida ya se actualizó, pero la muerte todavía no se ha procesado. Vuelve a intentarlo en un momento.' });
      }
      if (job.status === 'error') {
        return res.status(400).json({ error: job.result_text });
      }

      updated = JSON.parse(job.result_text);
      diedNow = true;
    }

    logger.info(`[MapServer] ${req.session.user.username} editó stats de ${discordId}: ${Object.keys(updates).join(', ')}${diedNow ? ' (murió)' : ''}`);
    auditWeb(req, 'player.update_stats', discordId, { ...updates, diedNow });
    res.json({ ...updated, diedNow });
  }));

  router.patch('/api/players/:discordId/identity', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const { fullName, nationality, originCountry, religion, description, gender } = req.body ?? {};
    const updated = await updateCharacterIdentity(discordId, { fullName, nationality, originCountry, religion, description, gender });

    const editedFields = Object.keys(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó identidad de ${discordId}: ${editedFields.join(', ')}`);
    auditWeb(req, 'player.update_identity', discordId, { fields: editedFields });
    res.json(updated);
  }));

  router.post('/api/players/:discordId/laburo', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const { action, amount } = req.body ?? {};
    let result;
    if (action === 'add') result = await earnLaburo(discordId, amount);
    else if (action === 'remove') result = await spendLaburo(discordId, amount);
    else if (action === 'reset') result = await adminSetLaburo(discordId, 0);
    else if (action === 'set') result = await adminSetLaburo(discordId, amount);
    else return res.status(400).json({ error: '`action` debe ser add, remove, reset o set.' });

    const balance = await getAvailableLaburo(discordId);
    logger.info(`[MapServer] ${req.session.user.username} ajustó Laburo de ${discordId}: ${action}${amount != null ? ` ${amount}` : ''} → saldo ${balance}`);
    auditWeb(req, 'player.laburo', discordId, { action, amount, balance });
    res.json({ ...result, balance });
  }));

  router.post('/api/players/:discordId/inventory', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const { action, itemName, quantity } = req.body ?? {};
    if (!itemName || !Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ error: '`itemName` y `quantity` (> 0) son obligatorios.' });
    }
    let result;
    if (action === 'add') result = await addItem(discordId, itemName, quantity);
    else if (action === 'remove') result = await removeItem(discordId, itemName, quantity);
    else if (action === 'set') result = await setItemQuantity(discordId, itemName, quantity);
    else return res.status(400).json({ error: '`action` debe ser add, remove o set.' });

    logger.info(`[MapServer] ${req.session.user.username} editó inventario de ${discordId}: ${action} ${quantity} "${itemName}" → ${result.newQuantity}`);
    auditWeb(req, 'inventory.edit', discordId, { action, itemName, quantity, newQuantity: result.newQuantity });
    res.json(result);
  }));

  router.patch('/api/players/:discordId/inventory/order', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const { itemNames } = req.body ?? {};
    if (!Array.isArray(itemNames)) {
      return res.status(400).json({ error: '`itemNames` debe ser un array de nombres de ítem.' });
    }
    await setInventorySlotOrder(discordId, itemNames);
    res.json({ inventory: await getInventory(discordId) });
  }));

  router.post('/api/players/:discordId/effects', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const { effectType, laburoModifier, hpDeltaPerDay, durationHours } = req.body ?? {};
    if (!effectType) return res.status(400).json({ error: '`effectType` es obligatorio.' });
    const type = await getEffectType(effectType);
    if (!type) return res.status(400).json({ error: `No existe ningún tipo de estado llamado "${effectType}".` });

    await applyEffect(
      discordId, effectType,
      laburoModifier ?? type.laburo_modifier ?? 0,
      hpDeltaPerDay ?? type.hp_delta_per_day ?? 0,
      durationHours || null
    );
    const updated = await getPlayerStats(discordId);
    logger.info(`[MapServer] ${req.session.user.username} aplicó el estado "${effectType}" a ${discordId}`);
    auditWeb(req, 'player.apply_effect', discordId, { effectType, laburoModifier, hpDeltaPerDay, durationHours });
    res.json({ effects: await Promise.all(updated.effects.map(async e => ({ ...e, meta: await getEffectType(e.effect_type) }))) });
  }));

  router.delete('/api/players/:discordId/effects/:effectType', requireRole('isRolepriest'), handler(async (req, res) => {
    const discordId = req.params.discordId;
    const effectType = req.params.effectType;
    const removedCount = await removeEffect(discordId, effectType);
    const updated = await getPlayerStats(discordId);
    logger.info(`[MapServer] ${req.session.user.username} quitó el estado "${effectType}" a ${discordId} (${removedCount})`);
    auditWeb(req, 'player.remove_effect', discordId, { effectType, removedCount });
    res.json({ effects: await Promise.all(updated.effects.map(async e => ({ ...e, meta: await getEffectType(e.effect_type) }))) });
  }));

  return router;
}
