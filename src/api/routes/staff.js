import { Router } from 'express';
import logger from '../../utils/logger.js';
import {
  mergeChannelOverwrites, listPlayersWithChannel, PLAYER_CHANNEL_PERMISSIONS,
} from '../../services/modmailService.js';
import { slugify } from '../../utils/text.js';
import { enqueueJob } from '../../services/botJobService.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { auditWeb } from '../state/audit.js';
import { BOT_TOKEN } from '../env.js';

const MEMBER_OVERWRITE_TYPE = 1;
const PLAYER_CHANNEL_ALLOW_BITMASK = String(
  PLAYER_CHANNEL_PERMISSIONS.reduce((acc, bit) => acc | bit, 0n)
);

export function createStaffRouter() {
  const router = Router();

  router.post('/api/staff/sync-channels', requireRole('isRolepriest'), handler(async (req, res) => {
    const players = await listPlayersWithChannel();
    const result = { total: players.length, updated: 0, renamed: 0, skipped: 0, errors: [] };
    const categoryOverwritesCache = new Map();

    for (const player of players) {
      const displayName = player.character_name ?? player.username;
      try {
        const chRes = await fetch(`https://discord.com/api/channels/${player.modmail_channel_id}`, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });
        if (!chRes.ok) { result.skipped++; continue; }
        const channelJson = await chRes.json();

        if (!channelJson.parent_id) { result.skipped++; continue; }

        if (!categoryOverwritesCache.has(channelJson.parent_id)) {
          const categoryRes = await fetch(`https://discord.com/api/channels/${channelJson.parent_id}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
          }).catch(() => null);
          categoryOverwritesCache.set(channelJson.parent_id, categoryRes?.ok ? (await categoryRes.json()).permission_overwrites ?? [] : []);
        }
        const categoryOverwrites = categoryOverwritesCache.get(channelJson.parent_id);

        const overwrites = mergeChannelOverwrites(categoryOverwrites, player.discord_id, {
          type: MEMBER_OVERWRITE_TYPE,
          allow: PLAYER_CHANNEL_ALLOW_BITMASK,
          deny: '0',
        });

        const body = { permission_overwrites: overwrites };
        const desiredName = `rp-${slugify(displayName)}`;
        const willRename = channelJson.name?.startsWith('md-') && channelJson.name !== desiredName;
        if (willRename) body.name = desiredName;

        const patchRes = await fetch(`https://discord.com/api/channels/${player.modmail_channel_id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!patchRes.ok) {
          result.errors.push(`${displayName}: HTTP ${patchRes.status}`);
          continue;
        }

        result.updated++;
        if (willRename) result.renamed++;
      } catch (err) {
        result.errors.push(`${displayName}: ${err.message}`);
      }
    }

    logger.info(
      `[API] ${req.session.user.username} sincronizó canales de personaje: ` +
      `${result.updated}/${result.total} actualizados, ${result.renamed} renombrados, ${result.errors.length} error(es)`
    );
    auditWeb(req, 'settings.sync_channels', 'todos', result);

    result.identityCardsJobId = await enqueueJob('channels.sync_identity_cards', {}, req.session.user.id);

    res.json(result);
  }));

  return router;
}
