




























import { Router } from 'express';
import multer from 'multer';
import { unlink } from 'fs/promises';
import logger from '../../utils/logger.js';
import { buildAssetUrl } from '../../utils/publicUrl.js';
import { validateImageBuffer, saveImageBuffer, MAX_IMAGE_SIZE_BYTES } from '../../utils/imageUpload.js';
import { enqueueJob, getJobResult } from '../../services/botJobService.js';
import { requireRole } from '../middleware/auth.js';
import { auditWeb } from '../state/audit.js';
import { config } from '../../utils/permissions.js';

const MAX_IMAGES = 4;
const BROADCAST_WRITE_PATH = `${(config.images?.avatarsHostPath ?? '/app/avatars').replace(/\/$/, '')}/broadcast`;
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: MAX_IMAGES } });

export function createBroadcastRouter() {
  const router = Router();

  router.post('/api/broadcast', requireRole('isRolepriest'), upload.array('imagenes', MAX_IMAGES), async (req, res) => {
    const message = (req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Falta el mensaje.' });
    if (message.length > 1500) return res.status(400).json({ error: 'El mensaje no puede pasar de 1500 caracteres.' });

    const files = req.files ?? [];
    const validations = files.map(validateImageBuffer);
    const invalid = validations.find(v => !v.ok);
    if (invalid) return res.status(400).json({ error: invalid.error });



    const savedFilepaths = [];
    const imageUrls = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validation = validations[i];
        const filenameBase = `broadcast_${Date.now()}_${i}`;
        const { filepath } = await saveImageBuffer(file.buffer, validation.ext, BROADCAST_WRITE_PATH, filenameBase);
        savedFilepaths.push(filepath);
        const url = buildAssetUrl(`avatars/broadcast/${filenameBase}.${validation.ext}`, '/api/broadcast');
        if (!url) {
          throw new Error('NGINX_BASE_URL no está configurado o no es alcanzable desde fuera — no se puede adjuntar ninguna imagen.');
        }
        imageUrls.push(url);
      }
    } catch (err) {
      await Promise.all(savedFilepaths.map(p => unlink(p).catch(() => {})));
      return res.status(400).json({ error: err.message });
    }

    const jobId = await enqueueJob('staff.broadcast', { message, imageUrls }, req.session.user.id);



    if (savedFilepaths.length > 0) {
      setTimeout(() => {
        Promise.all(savedFilepaths.map(p => unlink(p).catch(() => {})))
          .catch(() => {});
      }, CLEANUP_DELAY_MS).unref();
    }

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

    const result = JSON.parse(job.result_text);
    logger.info(`[MapServer] ${req.session.user.username} mandó un broadcast: ${result.sent}/${result.totalTargets} (${result.failed} fallidos, ${files.length} imagen(es))`);
    auditWeb(req, 'staff.broadcast', 'todos', { message, ...result, images: files.length });

    res.json(result);
  });

  return router;
}
