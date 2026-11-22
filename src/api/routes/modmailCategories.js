
import { Router } from 'express';
import logger from '../../utils/logger.js';
import { listCategories } from '../../services/modmailCategoryService.js';
import { enqueueJob, getJobResult } from '../../services/botJobService.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';
import { BOT_TOKEN, GUILD_ID } from '../env.js';

const MAX_CHANNELS_PER_CATEGORY = 50;

export function createModmailCategoriesRouter() {
  const router = Router();

  router.get('/api/modmail-categories', requireRole('isRolepriest'), handler(async (req, res) => {
    const rows = await listCategories();
    if (rows.length === 0) return res.json([]);

    const channelsRes = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/channels`, {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    }).catch(() => null);
    const allChannels = channelsRes?.ok ? await channelsRes.json() : [];

    const result = rows.map(row => {
      const category = allChannels.find(c => c.id === row.discord_category_id);
      const channelCount = allChannels.filter(c => c.parent_id === row.discord_category_id).length;
      return {
        id: row.id,
        discordCategoryId: row.discord_category_id,
        displayName: category?.name ?? row.display_name ?? row.discord_category_id,
        exists: Boolean(category),
        channelCount,
        maxChannels: MAX_CHANNELS_PER_CATEGORY,
        createdAt: row.created_at,
      };
    });
    res.json(result);
  }));

  router.post('/api/modmail-categories', requireRole('isRolepriest'), handler(async (req, res) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'Falta el nombre de la categoría.' });

    const jobId = await enqueueJob('modmail.create_category', { name }, req.session.user.id);
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

    const created = JSON.parse(job.result_text);
    logger.info(`[API] ${req.session.user.username} creó la categoría de modmail "#${created.name}" (${created.id})`);
    auditWeb(req, 'modmail.category_created', created.id, { name: created.name });
    res.status(201).json(created);
  }));

  return router;
}
