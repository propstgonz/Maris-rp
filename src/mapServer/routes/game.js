import { Router } from 'express';
import multer from 'multer';
import { requireSession, requirePlayer } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { UserFacingError } from '../../utils/errors.js';
import { GENDER_CHOICES } from '../../utils/text.js';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import { validateImageBuffer, saveImageBuffer, MAX_IMAGE_SIZE_BYTES } from '../../utils/imageUpload.js';
import { config } from '../../utils/permissions.js';
import { getPlayerByDiscordId, getPlayerStats, getActiveEffectModifiers, getOrCreatePlayer, getPlayerAtTileByCharacterName } from '../../services/playerService.js';
import { getInventory, getInventoryWeight } from '../../services/inventoryService.js';
import { getEmpireSummary, collectAllProduction } from '../../services/empireService.js';
import { beginTravel, cancelTravel, getTravelStatus } from '../../services/travelService.js';
import { attemptGather } from '../../services/resourceGatherService.js';
import { grabItem, dropItem } from '../../services/tileItemService.js';
import { performLaburar, getAvailableLaburo, getLaburoCooldownRemaining } from '../../services/laburoService.js';
import { tradeBetweenPlayers } from '../../services/tradeService.js';
import { listCraftableForPlayer } from '../../services/craftService.js';
import { useConstruction } from '../../services/constructionUseService.js';
import { removeConstruction, getConstructionsInRadius } from '../../services/mapService.js';
import { repairConstruction } from '../../services/constructionRepairService.js';
import { refuelConstruction } from '../../services/constructionFuelService.js';
import { enqueueJob, enqueueJobAndAwait } from '../../services/botJobService.js';
import { getPlayerWeapons, weaponMaxRange } from '../../services/combatService.js';
import { KIND, collectTargets } from '../../services/attackTargetingService.js';
import { auditWeb } from '../state/audit.js';
import { playerSseClients, openSseStream } from '../state/sse.js';

const GENDER_VALUES = new Set(GENDER_CHOICES.map(c => c.value));

const AVATARS_WRITE_PATH = (config.images?.avatarsHostPath ?? '/app/avatars').replace(/\/$/, '');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE_BYTES } });

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createGameRouter() {
  const router = Router();

  router.post('/api/game/character', requireSession, upload.single('imagen'), handler(async (req, res) => {
    if (req.session.user.hasCharacter) {
      return res.status(400).json({ error: 'Ya tienes un personaje creado.' });
    }

    const fullName = trim(req.body?.fullName);
    const originCountry = trim(req.body?.originCountry);
    const nationality = trim(req.body?.nationality);
    const religion = trim(req.body?.religion) || null;
    const description = trim(req.body?.description) || null;
    const gender = trim(req.body?.gender) || null;

    if (!fullName || !originCountry || !nationality) {
      return res.status(400).json({ error: 'El nombre completo, el país de origen y la nacionalidad no pueden estar vacíos.' });
    }
    if (fullName.length > 100 || originCountry.length > 56 || nationality.length > 56 || (religion?.length ?? 0) > 56 || (description?.length ?? 0) > 50) {
      return res.status(400).json({ error: 'Alguno de los campos supera su longitud máxima.' });
    }
    if (gender !== null && !GENDER_VALUES.has(gender)) {
      return res.status(400).json({ error: 'Género no válido.' });
    }

    await getOrCreatePlayer(req.session.user.id, req.session.user.username);

    let avatarFilename = null;
    if (req.file) {
      const validation = validateImageBuffer(req.file);
      if (!validation.ok) return res.status(400).json({ error: validation.error });
      const saved = await saveImageBuffer(req.file.buffer, validation.ext, AVATARS_WRITE_PATH, `player_${req.session.user.id}`);
      avatarFilename = `avatars/${saved.filename}`;
    }

    const created = await enqueueJobAndAwait('character.create', {
      discordId: req.session.user.id, fullName, nationality, originCountry, religion, description, gender, avatarFilename,
    }, req.session.user.id);

    req.session.user.hasCharacter = true;
    auditWeb(req, 'personaje.crear', req.session.user.id, { fullName });

    res.json(created);
  }));

  router.get('/api/game/me', requirePlayer, handler(async (req, res) => {
    const stats = await getPlayerStats(req.session.user.id);
    const [laburoAvailable, laburoCooldownSeconds, travel, effects] = await Promise.all([
      getAvailableLaburo(req.session.user.id),
      getLaburoCooldownRemaining(req.session.user.id),
      getTravelStatus(req.session.user.id),
      getActiveEffectModifiers(req.session.user.id),
    ]);
    res.json({
      characterName: stats.character_name,
      fullName: stats.full_name,
      originCountry: stats.origin_country,
      nationality: stats.nationality,
      religion: stats.religion,
      description: stats.description,
      gender: stats.gender,
      hp: stats.hp,
      hunger: stats.hunger,
      isAlive: Boolean(stats.is_alive),
      isImmortal: Boolean(stats.is_immortal),
      x: stats.coord_x,
      y: stats.coord_y,
      avatarUrl: getAvatarUrl(stats, '/api/game/me'),
      factionDisplayName: stats.faction_display_name,
      factionEmoji: stats.faction_emoji,
      effects,
      laburoAvailable,
      laburoCooldownSeconds,
      travel,
    });
  }));

  router.get('/api/game/events', requirePlayer, (req, res) => {
    const discordId = req.session.user.id;
    if (!playerSseClients.has(discordId)) playerSseClients.set(discordId, new Set());
    const clients = playerSseClients.get(discordId);
    clients.add(res);
    openSseStream(res, () => {
      clients.delete(res);
      if (clients.size === 0) playerSseClients.delete(discordId);
    });
  });

  router.post('/api/game/travel', requirePlayer, handler(async (req, res) => {
    const x = Number(req.body?.x);
    const y = Number(req.body?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return res.status(400).json({ error: '`x`/`y` deben ser enteros.' });
    }
    const trip = await beginTravel(req.session.user.id, x, y);
    auditWeb(req, 'travel.start', req.session.user.id, { from: trip.from, to: trip.to, steps: trip.steps, speedMultiplier: trip.speedMultiplier, etaHours: trip.etaHours, redirected: trip.redirected });
    await enqueueJob('travel.web_started', { discordId: req.session.user.id, trip }, req.session.user.id);
    res.json(trip);
  }));

  router.post('/api/game/travel/cancel', requirePlayer, handler(async (req, res) => {
    const cancelled = await cancelTravel(req.session.user.id);
    if (cancelled) auditWeb(req, 'travel.cancel', req.session.user.id, null);
    res.json({ cancelled });
  }));

  router.post('/api/game/gather', requirePlayer, handler(async (req, res) => {
    const itemName = trim(req.body?.itemName);
    if (!itemName) return res.status(400).json({ error: '`itemName` es obligatorio.' });
    const result = await attemptGather(req.session.user.id, itemName);
    auditWeb(req, 'gather.attempt', `(${result.x},${result.y})`, { targetItem: itemName, hit: result.hit, grantedItemName: result.grantedItemName, wasTarget: result.wasTarget, grantedQuantity: result.grantedQuantity });
    res.json(result);
  }));

  router.post('/api/game/grab', requirePlayer, handler(async (req, res) => {
    const itemName = trim(req.body?.itemName);
    if (!itemName) return res.status(400).json({ error: '`itemName` es obligatorio.' });
    const quantity = req.body?.quantity != null ? Number(req.body.quantity) : null;

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const result = await grabItem(req.session.user.id, player.coord_x, player.coord_y, itemName, quantity);
    auditWeb(req, 'tile.item_grab', `(${player.coord_x},${player.coord_y})`, { itemName, quantity: result.grabbed });
    res.json(result);
  }));

  router.post('/api/game/drop', requirePlayer, handler(async (req, res) => {
    const itemName = trim(req.body?.itemName);
    if (!itemName) return res.status(400).json({ error: '`itemName` es obligatorio.' });
    const quantity = Number(req.body?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: '`quantity` debe ser un número positivo.' });

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const result = await dropItem(req.session.user.id, player.coord_x, player.coord_y, itemName, quantity);
    auditWeb(req, 'tile.item_drop', `(${player.coord_x},${player.coord_y})`, { itemName, quantity });
    res.json(result);
  }));

  router.post('/api/game/consume', requirePlayer, handler(async (req, res) => {
    const itemName = trim(req.body?.itemName);
    if (!itemName) return res.status(400).json({ error: '`itemName` es obligatorio.' });

    const result = await enqueueJobAndAwait('item.web_consume', { discordId: req.session.user.id, itemName }, req.session.user.id);
    res.json(result);
  }));

  router.post('/api/game/flee', requirePlayer, handler(async (req, res) => {
    const result = await enqueueJobAndAwait('combat.web_flee', { discordId: req.session.user.id, username: req.session.user.username }, req.session.user.id);
    res.json(result);
  }));

  router.post('/api/game/laburo', requirePlayer, handler(async (req, res) => {
    const result = await performLaburar(req.session.user.id);
    auditWeb(req, 'laburo.earn', req.session.user.id, { amount: result.amount, modifierSum: result.modifierSum, expiresAt: result.expiresAt });
    res.json(result);
  }));

  router.post('/api/game/laburo/trade', requirePlayer, handler(async (req, res) => {
    const characterName = trim(req.body?.characterName);
    const quantity = Number(req.body?.quantity);
    if (!characterName) return res.status(400).json({ error: '`characterName` es obligatorio.' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: '`quantity` debe ser un número positivo.' });

    const me = await getPlayerByDiscordId(req.session.user.id);
    if (!me) throw new UserFacingError('Tu perfil no está registrado.');

    const recipient = await getPlayerAtTileByCharacterName(me.coord_x, me.coord_y, characterName);
    if (!recipient) {
      return res.status(400).json({ error: `No hay nadie llamado "${characterName}" en tu casilla.` });
    }

    const result = await tradeBetweenPlayers(req.session.user.id, recipient.discord_id, 'laburo', quantity);
    auditWeb(req, 'laburo.trade', recipient.discord_id, { toCharacterName: recipient.character_name, quantity: result.quantity });
    res.json({ toCharacterName: recipient.character_name, quantity: result.quantity, totalAvailable: await getAvailableLaburo(req.session.user.id) });
  }));

  router.post('/api/game/trade', requirePlayer, handler(async (req, res) => {
    const characterName = trim(req.body?.characterName);
    const itemName = trim(req.body?.itemName);
    const quantity = Number(req.body?.quantity);
    if (!characterName) return res.status(400).json({ error: '`characterName` es obligatorio.' });
    if (!itemName) return res.status(400).json({ error: '`itemName` es obligatorio.' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: '`quantity` debe ser un número positivo.' });

    const me = await getPlayerByDiscordId(req.session.user.id);
    if (!me) throw new UserFacingError('Tu perfil no está registrado.');

    const recipient = await getPlayerAtTileByCharacterName(me.coord_x, me.coord_y, characterName);
    if (!recipient) {
      return res.status(400).json({ error: `No hay nadie llamado "${characterName}" en tu casilla.` });
    }

    const offer = await enqueueJobAndAwait('trade.web_propose', {
      fromDiscordId: req.session.user.id, toDiscordId: recipient.discord_id, itemName, quantity,
      coord: { x: me.coord_x, y: me.coord_y },
    }, req.session.user.id);
    res.json({ toCharacterName: recipient.character_name, item: offer.item, quantity, pending: true });
  }));

  async function resolveWeaponById(discordId, weaponId) {
    if (!weaponId || weaponId === 'm') return null;
    const weapons = await getPlayerWeapons(discordId);
    const weapon = weapons.find(w => String(w.id) === weaponId);
    if (!weapon) throw new UserFacingError('Ya no llevas esa arma encima — vuelve a abrir el panel de ataque.');
    return weapon;
  }

  router.get('/api/game/attack/weapons', requirePlayer, handler(async (req, res) => {
    const weapons = await getPlayerWeapons(req.session.user.id);
    res.json(weapons.map(w => ({
      id: String(w.id), name: w.name, displayName: w.display_name, emoji: w.emoji,
      damage: w.weapon_damage, structureDamage: Boolean(w.weapon_structure_damage), range: weaponMaxRange(w),
    })));
  }));

  router.get('/api/game/attack/targets', requirePlayer, handler(async (req, res) => {
    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const weapon = await resolveWeaponById(req.session.user.id, trim(req.query?.weaponId));
    const targets = await collectTargets(player, weapon);
    res.json({
      range: weapon ? weaponMaxRange(weapon) : 0,
      targets: targets.map(t => ({ kind: t.kind, id: t.id, label: t.label, detail: t.detail, emoji: t.emoji, distance: t.distance })),
    });
  }));

  router.post('/api/game/attack', requirePlayer, handler(async (req, res) => {
    const kind = trim(req.body?.kind);
    const targetId = trim(req.body?.targetId);
    if (!kind || !targetId) return res.status(400).json({ error: '`kind` y `targetId` son obligatorios.' });

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const weapon = await resolveWeaponById(req.session.user.id, trim(req.body?.weaponId));
    const weaponName = weapon?.name ?? null;

    if (kind === KIND.player) {
      const result = await enqueueJobAndAwait('combat.attack_player', {
        attackerDiscordId: req.session.user.id, targetDiscordId: targetId, weaponName,
      }, req.session.user.id);
      return res.json(result);
    }

    if (kind === KIND.npc) {
      if (!weaponName) return res.status(400).json({ error: 'Necesitas un arma para atacar a un NPC.' });
      const result = await enqueueJobAndAwait('combat.attack_npc', {
        attackerDiscordId: req.session.user.id, npcId: Number(targetId), weaponName,
      }, req.session.user.id);
      return res.json(result);
    }

    if (kind === KIND.construction) {
      if (!weaponName) return res.status(400).json({ error: 'Necesitas un arma para atacar una construcción.' });

      const range = weaponMaxRange(weapon);
      const nearby = await getConstructionsInRadius(player.coord_x, player.coord_y, range);
      const construction = nearby.find(c => String(c.id) === targetId);
      if (!construction) return res.status(400).json({ error: 'Esa construcción ya no está a tu alcance.' });

      const result = await enqueueJobAndAwait('combat.attack_construction', {
        attackerDiscordId: req.session.user.id, x: construction.coord_x, y: construction.coord_y,
        constructionTypeName: construction.ct_name, weaponName, constructionId: construction.id,
      }, req.session.user.id);
      return res.json(result);
    }

    return res.status(400).json({ error: '`kind` debe ser "p", "n" o "c".' });
  }));

  router.post('/api/game/construction/repair', requirePlayer, handler(async (req, res) => {
    const typeName = trim(req.body?.typeName);
    if (!typeName) return res.status(400).json({ error: '`typeName` es obligatorio.' });
    const constructionId = req.body?.constructionId != null ? Number(req.body.constructionId) : null;

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const result = await repairConstruction(
      req.session.user.id, player.coord_x, player.coord_y, typeName,
      { isRolepriest: Boolean(req.session.user.isRolepriest) }, constructionId
    );
    auditWeb(req, 'tile.construction_repair', `(${player.coord_x},${player.coord_y})`, { constructionType: typeName, laburoCost: result.laburoCost });
    res.json(result);
  }));

  router.post('/api/game/construction/refuel', requirePlayer, handler(async (req, res) => {
    const typeName = trim(req.body?.typeName);
    const quantity = Number(req.body?.quantity);
    if (!typeName) return res.status(400).json({ error: '`typeName` es obligatorio.' });
    if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: '`quantity` debe ser un número positivo.' });
    const constructionId = req.body?.constructionId != null ? Number(req.body.constructionId) : null;

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const result = await refuelConstruction(
      req.session.user.id, player.coord_x, player.coord_y, typeName, quantity,
      { isRolepriest: Boolean(req.session.user.isRolepriest) }, constructionId
    );
    auditWeb(req, 'tile.construction_refuel', `(${player.coord_x},${player.coord_y})`, { constructionType: typeName, added: result.added, fuelItem: result.fuelItem.name });
    res.json(result);
  }));

  router.post('/api/game/construction/destroy', requirePlayer, handler(async (req, res) => {
    const constructionId = Number(req.body?.constructionId);
    if (!Number.isInteger(constructionId)) return res.status(400).json({ error: '`constructionId` debe ser un entero.' });

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const result = await removeConstruction(
      constructionId, { discordId: req.session.user.id, isRolepriest: Boolean(req.session.user.isRolepriest) },
      { x: player.coord_x, y: player.coord_y }
    );
    auditWeb(req, 'tile.construction_destroy', `(${result.coord_x},${result.coord_y})`, { constructionId, constructionName: result.name });
    res.json(result);
  }));

  router.get('/api/game/craft/options', requirePlayer, handler(async (req, res) => {
    res.json(await listCraftableForPlayer(req.session.user.id));
  }));

  router.post('/api/game/craft', requirePlayer, handler(async (req, res) => {
    const itemName = trim(req.body?.itemName);
    if (!itemName) return res.status(400).json({ error: '`itemName` es obligatorio.' });
    const recipeId = req.body?.recipeId != null ? Number(req.body.recipeId) : null;
    const result = await enqueueJobAndAwait('craft.web_craft', {
      discordId: req.session.user.id, itemName, recipeId,
    }, req.session.user.id);
    res.json(result);
  }));

  router.post('/api/game/construction/use', requirePlayer, handler(async (req, res) => {
    const typeName = trim(req.body?.typeName);
    if (!typeName) return res.status(400).json({ error: '`typeName` es obligatorio.' });
    const constructionId = req.body?.constructionId != null ? Number(req.body.constructionId) : null;

    const player = await getPlayerByDiscordId(req.session.user.id);
    if (!player) throw new UserFacingError('Tu perfil no está registrado.');

    const result = await useConstruction(
      req.session.user.id, player.coord_x, player.coord_y, typeName,
      { isRolepriest: Boolean(req.session.user.isRolepriest) }, constructionId
    );
    auditWeb(req, 'tile.construction_use', `(${player.coord_x},${player.coord_y})`, { constructionType: typeName, hit: result.yieldAmount > 0, yieldAmount: result.yieldAmount, resultItem: result.resultItem.name });
    res.json(result);
  }));

  router.get('/api/game/empire', requirePlayer, handler(async (req, res) => {
    res.json(await getEmpireSummary(req.session.user.id));
  }));

  router.post('/api/game/empire/collect', requirePlayer, handler(async (req, res) => {
    const lines = await collectAllProduction(req.session.user.id);
    if (lines.length > 0) auditWeb(req, 'empire.collect', req.session.user.id, { lines });
    res.json({ lines });
  }));

  router.get('/api/game/inventory', requirePlayer, handler(async (req, res) => {
    const [items, weight] = await Promise.all([
      getInventory(req.session.user.id),
      getInventoryWeight(req.session.user.id),
    ]);
    res.json({ items, ...weight });
  }));

  return router;
}
