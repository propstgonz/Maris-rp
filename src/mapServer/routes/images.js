import { Router } from 'express';
import multer from 'multer';
import logger from '../../utils/logger.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import {
  validateImageBuffer, saveImageBuffer, MAX_IMAGE_SIZE_BYTES, sanitizeFilenameComponent,
} from '../../utils/imageUpload.js';
import { getPlayerByDiscordId, setAvatarFilename } from '../../services/playerService.js';
import { getItemByName, setItemImage } from '../../services/itemService.js';
import { getConstructionTypeByName, setConstructionTypeImage } from '../../services/constructionTypeService.js';
import { getNpcTypeByName, setNpcTypeImage } from '../../services/npcTypeService.js';
import { requireRole } from '../middleware/auth.js';
import { auditWeb } from '../state/audit.js';
import { broadcastChange } from '../state/sse.js';
import { config } from '../../utils/permissions.js';

const AVATARS_WRITE_PATH       = (config.images?.avatarsHostPath       ?? '/app/avatars').replace(/\/$/, '');
const ITEMS_WRITE_PATH         = (config.images?.itemsHostPath         ?? '/app/items').replace(/\/$/, '');

const CONSTRUCTIONS_WRITE_PATH = (config.images?.constructionsHostPath ?? '/app/constructions').replace(/\/$/, '');
const NPCS_WRITE_PATH          = (config.images?.npcsHostPath           ?? '/app/npcs').replace(/\/$/, '');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE_BYTES } });

export function createImagesRouter() {
  const router = Router();

  router.post('/api/players/:discordId/avatar', requireRole('isRolepriest'), upload.single('imagen'), async (req, res) => {
    const discordId = req.params.discordId;
    try {
      const player = await getPlayerByDiscordId(discordId);
      if (!player) return res.status(404).json({ error: 'No se encontraron datos de ese jugador.' });
      if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

      const validation = validateImageBuffer(req.file);
      if (!validation.ok) return res.status(400).json({ error: validation.error });

      await saveImageBuffer(req.file.buffer, validation.ext, AVATARS_WRITE_PATH, `player_${discordId}`);
      const relativeFilename = `avatars/player_${discordId}.${validation.ext}`;
      await setAvatarFilename(discordId, relativeFilename);
      logger.info(
        `[MapServer] ${req.session.user.username} subió un avatar para ${player.username} ` +
        `(${(req.file.size / 1024).toFixed(1)} KB, ${validation.mimeType})`
      );
      auditWeb(req, 'player.set_avatar', discordId, { size: req.file.size, mimeType: validation.mimeType });

      broadcastChange('map');
      res.json({ avatarUrl: buildAssetUrl(relativeFilename, '/api/players/:discordId/avatar') });
    } catch (err) {
      res.status(500).json({ error: `No se pudo guardar la imagen: ${err.message}` });
    }
  });

  router.post('/api/items/:name/image', requireRole('isRolepriest'), upload.single('imagen'), async (req, res) => {
    const itemName = req.params.name;
    try {
      const item = await getItemByName(itemName);
      if (!item) return res.status(404).json({ error: `No existe ningún ítem llamado "${itemName}".` });
      if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

      const validation = validateImageBuffer(req.file);
      if (!validation.ok) return res.status(400).json({ error: validation.error });

      const safeName = sanitizeFilenameComponent(itemName);
      await saveImageBuffer(req.file.buffer, validation.ext, ITEMS_WRITE_PATH, `item_${safeName}`);
      const relativeFilename = `items/item_${safeName}.${validation.ext}`;
      const updated = await setItemImage(itemName, relativeFilename);
      logger.info(`[MapServer] ${req.session.user.username} subió una imagen para el ítem "${itemName}"`);
      auditWeb(req, 'item.set_image', itemName, { size: req.file.size, mimeType: validation.mimeType });
      res.json({ ...updated, image_url: buildAssetUrl(relativeFilename, '/api/items/:name/image') });
    } catch (err) {
      res.status(500).json({ error: `No se pudo guardar la imagen: ${err.message}` });
    }
  });

  router.post('/api/construction-types/:name/image', requireRole('isRolepriest'), upload.single('imagen'), async (req, res) => {
    const typeName = req.params.name;
    try {
      const type = await getConstructionTypeByName(typeName);
      if (!type) return res.status(404).json({ error: `No existe ningún tipo de construcción llamado "${typeName}".` });
      if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

      const validation = validateImageBuffer(req.file);
      if (!validation.ok) return res.status(400).json({ error: validation.error });

      const safeName = sanitizeFilenameComponent(typeName);
      await saveImageBuffer(req.file.buffer, validation.ext, CONSTRUCTIONS_WRITE_PATH, `construction_${safeName}`);
      const relativeFilename = `constructions/construction_${safeName}.${validation.ext}`;
      const updated = await setConstructionTypeImage(typeName, relativeFilename);
      logger.info(`[MapServer] ${req.session.user.username} subió una imagen para el tipo de construcción "${typeName}"`);
      auditWeb(req, 'construction.set_image', typeName, { size: req.file.size, mimeType: validation.mimeType });

      broadcastChange('map');
      res.json({ ...updated, image_url: buildAssetUrl(relativeFilename, '/api/construction-types/:name/image') });
    } catch (err) {
      res.status(500).json({ error: `No se pudo guardar la imagen: ${err.message}` });
    }
  });

  router.post('/api/npc-types/:name/image', requireRole('isRolepriest'), upload.single('imagen'), async (req, res) => {
    const typeName = req.params.name;
    try {
      const type = await getNpcTypeByName(typeName);
      if (!type) return res.status(404).json({ error: `No existe ningún tipo de NPC llamado "${typeName}".` });
      if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

      const validation = validateImageBuffer(req.file);
      if (!validation.ok) return res.status(400).json({ error: validation.error });

      const safeName = sanitizeFilenameComponent(typeName);
      await saveImageBuffer(req.file.buffer, validation.ext, NPCS_WRITE_PATH, `npc_${safeName}`);
      const relativeFilename = `npcs/npc_${safeName}.${validation.ext}`;
      const updated = await setNpcTypeImage(typeName, relativeFilename);
      logger.info(`[MapServer] ${req.session.user.username} subió una imagen para el tipo de NPC "${typeName}"`);
      auditWeb(req, 'npc.set_image', typeName, { size: req.file.size, mimeType: validation.mimeType });
      broadcastChange('map');
      res.json({ ...updated, image_url: buildAssetUrl(relativeFilename, '/api/npc-types/:name/image') });
    } catch (err) {
      res.status(500).json({ error: `No se pudo guardar la imagen: ${err.message}` });
    }
  });

  return router;
}
