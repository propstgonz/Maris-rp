import { Router } from 'express';
import logger from '../../utils/logger.js';
import { requireAuth, requireSession, getIdleLogoutMinutes } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { sseClients, openSseStream } from '../state/sse.js';
import { BOT_TOKEN } from '../env.js';

const DEFAULT_AVATAR_URL = '/static/default-avatar.svg';

const DISCORD_AVATAR_CACHE_TTL_MS = 45 * 60 * 1000;
const DISCORD_AVATAR_NEGATIVE_TTL_MS = 5 * 60 * 1000;
const avatarUrlCache = new Map();

export function createCoreRouter({ generateToken, avatarLimiter }) {
  const router = Router();

  router.get('/api/me', requireSession, handler(async (req, res) => {
    res.json({ ...req.session.user, csrfToken: generateToken(req), idleLogoutMinutes: await getIdleLogoutMinutes() });
  }));

  router.get('/api/discord-avatar/:discordId', requireAuth, avatarLimiter, async (req, res) => {
    const discordId = req.params.discordId;
    const cached = avatarUrlCache.get(discordId);
    if (cached && cached.expiresAt > Date.now()) {
      return res.redirect(302, cached.url);
    }

    let url = DEFAULT_AVATAR_URL;
    let ttl = DISCORD_AVATAR_NEGATIVE_TTL_MS;
    if (/^\d{15,25}$/.test(discordId)) {
      try {
        const userRes = await fetch(`https://discord.com/api/users/${discordId}`, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` },
        });
        if (userRes.ok) {
          const user = await userRes.json();
          if (user.avatar) {
            const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
            url = `https://cdn.discordapp.com/avatars/${discordId}/${user.avatar}.${ext}?size=64`;
          } else {
            const defaultIdx = Number((BigInt(discordId) >> 22n) % 6n);
            url = `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
          }
          ttl = DISCORD_AVATAR_CACHE_TTL_MS;
        }
      } catch (err) {
        logger.warn(`[API] No se pudo resolver el avatar de Discord de ${discordId}: ${err.message}`);
      }
    }

    avatarUrlCache.set(discordId, { url, expiresAt: Date.now() + ttl });
    res.redirect(302, url);
  });

  router.get('/api/events', requireAuth, (req, res) => {
    sseClients.add(res);
    openSseStream(res, () => sseClients.delete(res));
  });

  return router;
}
