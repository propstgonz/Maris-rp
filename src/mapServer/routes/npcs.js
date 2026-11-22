import { Router } from 'express';
import logger from '../../utils/logger.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import {
  listNpcTypes, getNpcTypeByName, createNpcType, updateNpcType, deleteNpcType,
  getTerrains as getNpcTypeTerrains, setNpcTypeTerrains,
  getZones as getNpcTypeZones, setNpcTypeZones,
  getDrops as getNpcTypeDrops, setNpcTypeDrops,
  getEquipment as getNpcTypeEquipment, setNpcTypeEquipment,
} from '../../services/npcTypeService.js';
import {
  listNpcGroupTypes, getNpcGroupTypeByName, createNpcGroupType, updateNpcGroupType, deleteNpcGroupType,
  getMembers as getNpcGroupMembers, setMembers as setNpcGroupMembers,
  getTerrains as getNpcGroupTerrains, setTerrains as setNpcGroupTerrains,
  getZones as getNpcGroupZones, setZones as setNpcGroupZones,
} from '../../services/npcGroupTypeService.js';
import { placeNpc, placeNpcGroup, removeNpc } from '../../services/npcService.js';
import { runWorldIntegrityChecks } from '../../services/worldIntegrityService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';
import { enqueueJob } from '../../services/botJobService.js';
import { broadcastChange } from '../state/sse.js';

async function enrichNpcType(t) {
  return {
    ...t,
    terrains: await getNpcTypeTerrains(t.id),
    zones: await getNpcTypeZones(t.id),
    drops: await getNpcTypeDrops(t.id),
    equipment: await getNpcTypeEquipment(t.id),
    image_url: t.image_filename ? buildAssetUrl(t.image_filename, '/api/npc-types') : null,
  };
}

async function enrichGroupType(g) {
  return {
    ...g,
    members: await getNpcGroupMembers(g.id),
    terrains: await getNpcGroupTerrains(g.id),
    zones: await getNpcGroupZones(g.id),
  };
}

export function createNpcsRouter() {
  const router = Router();

  router.get('/api/npc-types', requireAuth, handler(async (req, res) => {
    const types = await listNpcTypes();
    res.json(await Promise.all(types.map(enrichNpcType)));
  }));

  router.get('/api/npc-types/:name', requireAuth, handler(async (req, res) => {
    const type = await getNpcTypeByName(req.params.name);
    if (!type) return res.status(404).json({ error: `No existe ningún tipo de NPC llamado "${req.params.name}".` });
    res.json(await enrichNpcType(type));
  }));

  router.post('/api/npc-types', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createNpcType(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó el tipo de NPC "${created.name}"`);
    auditWeb(req, 'npc.create', created.name);
    res.status(201).json(await enrichNpcType(created));
  }));

  router.patch('/api/npc-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateNpcType(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó el tipo de NPC "${req.params.name}"`);
    auditWeb(req, 'npc.update', req.params.name, req.body);
    const { findings } = await runWorldIntegrityChecks({ scope: { entity: 'npc_type', entityName: updated.name } });
    res.json({ ...(await enrichNpcType(updated)), warnings: findings });
  }));

  router.patch('/api/npc-types/:name/terrains', requireRole('isRolepriest'), handler(async (req, res) => {
    const terrains = await setNpcTypeTerrains(req.params.name, req.body?.terrains ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó los terrenos de "${req.params.name}"`);
    auditWeb(req, 'npc.update_terrains', req.params.name, { terrains });
    res.json({ terrains });
  }));

  router.patch('/api/npc-types/:name/zones', requireRole('isRolepriest'), handler(async (req, res) => {
    const zones = await setNpcTypeZones(req.params.name, req.body?.zones ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó las zonas de "${req.params.name}"`);
    auditWeb(req, 'npc.update_zones', req.params.name, { zones });
    res.json({ zones });
  }));

  router.patch('/api/npc-types/:name/drops', requireRole('isRolepriest'), handler(async (req, res) => {
    const drops = await setNpcTypeDrops(req.params.name, req.body?.drops ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó el botín de "${req.params.name}"`);
    auditWeb(req, 'npc.update_drops', req.params.name, { drops });
    res.json({ drops });
  }));

  router.patch('/api/npc-types/:name/equipment', requireRole('isRolepriest'), handler(async (req, res) => {
    const equipment = await setNpcTypeEquipment(req.params.name, req.body?.equipment ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó el equipo requerido de "${req.params.name}"`);
    auditWeb(req, 'npc.update_equipment', req.params.name, { equipment });
    res.json({ equipment });
  }));

  router.delete('/api/npc-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteNpcType(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó el tipo de NPC "${req.params.name}"`);
    auditWeb(req, 'npc.delete', req.params.name);
    res.json(deleted);
  }));

  router.post('/api/npcs', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x, y, npcTypeId } = req.body ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(npcTypeId)) {
      return res.status(400).json({ error: 'x, y y npcTypeId deben ser enteros.' });
    }
    const npc = await placeNpc(x, y, npcTypeId);
    logger.info(`[MapServer] ${req.session.user.username} colocó un NPC "${npc.type_display_name}" en (${x},${y})`);
    auditWeb(req, 'npc.place', `(${x},${y})`, { npcTypeId });
    broadcastChange('map');
    res.status(201).json(npc);
  }));

  router.delete('/api/npcs/:id', requireRole('isRolepriest'), handler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const removed = await removeNpc(id);
    await enqueueJob('npc.remove_resolve_encounter', { npc: removed }, req.session.user.id);
    logger.info(`[MapServer] ${req.session.user.username} quitó el NPC "${removed.type_display_name}" #${id}`);
    auditWeb(req, 'npc.remove', String(id));
    broadcastChange('map');
    res.json({ ok: true });
  }));

  router.get('/api/npc-group-types', requireAuth, handler(async (req, res) => {
    const types = await listNpcGroupTypes();
    res.json(await Promise.all(types.map(enrichGroupType)));
  }));

  router.get('/api/npc-group-types/:name', requireAuth, handler(async (req, res) => {
    const type = await getNpcGroupTypeByName(req.params.name);
    if (!type) return res.status(404).json({ error: `No existe ningún grupo de NPC llamado "${req.params.name}".` });
    res.json(await enrichGroupType(type));
  }));

  router.post('/api/npc-group-types', requireRole('isRolepriest'), handler(async (req, res) => {
    const created = await createNpcGroupType(req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} creó el grupo de NPC "${created.name}"`);
    auditWeb(req, 'npcGroup.create', created.name);
    res.status(201).json(await enrichGroupType(created));
  }));

  router.patch('/api/npc-group-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const updated = await updateNpcGroupType(req.params.name, req.body ?? {});
    logger.info(`[MapServer] ${req.session.user.username} editó el grupo de NPC "${req.params.name}"`);
    auditWeb(req, 'npcGroup.update', req.params.name, req.body);
    res.json(await enrichGroupType(updated));
  }));

  router.patch('/api/npc-group-types/:name/members', requireRole('isRolepriest'), handler(async (req, res) => {
    const members = await setNpcGroupMembers(req.params.name, req.body?.members ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó la composición de "${req.params.name}"`);
    auditWeb(req, 'npcGroup.update_members', req.params.name, { members });
    res.json({ members });
  }));

  router.patch('/api/npc-group-types/:name/terrains', requireRole('isRolepriest'), handler(async (req, res) => {
    const terrains = await setNpcGroupTerrains(req.params.name, req.body?.terrains ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó los terrenos de "${req.params.name}"`);
    auditWeb(req, 'npcGroup.update_terrains', req.params.name, { terrains });
    res.json({ terrains });
  }));

  router.patch('/api/npc-group-types/:name/zones', requireRole('isRolepriest'), handler(async (req, res) => {
    const zones = await setNpcGroupZones(req.params.name, req.body?.zones ?? []);
    logger.info(`[MapServer] ${req.session.user.username} reemplazó las zonas del grupo "${req.params.name}"`);
    auditWeb(req, 'npcGroup.update_zones', req.params.name, { zones });
    res.json({ zones });
  }));

  router.delete('/api/npc-group-types/:name', requireRole('isRolepriest'), handler(async (req, res) => {
    const deleted = await deleteNpcGroupType(req.params.name);
    logger.info(`[MapServer] ${req.session.user.username} eliminó el grupo de NPC "${req.params.name}"`);
    auditWeb(req, 'npcGroup.delete', req.params.name);
    res.json(deleted);
  }));

  router.post('/api/npcs/group', requireRole('isRolepriest'), handler(async (req, res) => {
    const { x, y, groupTypeId } = req.body ?? {};
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(groupTypeId)) {
      return res.status(400).json({ error: 'x, y y groupTypeId deben ser enteros.' });
    }
    const npcs = await placeNpcGroup(x, y, groupTypeId);
    logger.info(`[MapServer] ${req.session.user.username} colocó un grupo de NPC (${npcs.length}) en (${x},${y})`);
    auditWeb(req, 'npcGroup.place', `(${x},${y})`, { groupTypeId, count: npcs.length });
    broadcastChange('map');
    res.status(201).json(npcs);
  }));

  return router;
}
