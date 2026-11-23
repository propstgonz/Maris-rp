import { Router } from 'express';
import crypto from 'crypto';
import logger from '../../utils/logger.js';
import { ROLE_ROLEPRIEST } from '../../utils/permissions.js';
import { CLIENT_ID, CLIENT_SECRET, GUILD_ID, BOT_TOKEN, REDIRECT_URI } from '../env.js';
import { sessionCookieFingerprint } from '../middleware/auth.js';

const DISCORD_INVITE_URL = 'https://discord.gg/zb8RZCbREg';

export function createAuthRouter({ authLimiter }) {
  const router = Router();

  router.get('/auth/login', authLimiter, (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  });

  router.get('/auth/callback', authLimiter, async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res.status(400).send('Solicitud de login inválida o caducada — vuelve a intentarlo desde el principio.');
    }
    delete req.session.oauthState;

    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: REDIRECT_URI,
        }),
      });
      if (!tokenRes.ok) throw new Error(`Intercambio de código OAuth falló (${tokenRes.status})`);
      const tokenData = await tokenRes.json();

      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (!userRes.ok) throw new Error(`No se pudo leer el usuario de Discord (${userRes.status})`);
      const discordUser = await userRes.json();

      const memberRes = await fetch(`https://discord.com/api/guilds/${GUILD_ID}/members/${discordUser.id}`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` },
      });
      if (memberRes.status === 404) {
        logger.info(`[API] Login: ${discordUser.username} (${discordUser.id}) no comparte servidor — redirigido a la invite.`);
        return res.redirect(DISCORD_INVITE_URL);
      }
      if (!memberRes.ok) throw new Error(`No se pudo leer la membresía del servidor (${memberRes.status})`);
      const member = await memberRes.json();
      const roles = member.roles ?? [];

      const isRolepriest = roles.some(r => ROLE_ROLEPRIEST.includes(r));

      await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
      req.session.user = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
        isRolepriest,
      };
      req.session.lastActivity = Date.now();
      req.session.roleCheckedAt = Date.now();
      logger.info(
        `[API] Login: ${discordUser.username} (${discordUser.id}) — ` +
        `rolepriest:${isRolepriest} cookie:...${sessionCookieFingerprint(req)}`
      );
      res.redirect('/');
    } catch (err) {
      logger.error(`[API] Error en /auth/callback: ${err.message}`);
      res.status(500).send('Error interno completando el login. Inténtalo de nuevo desde /auth/login.');
    }
  });

  router.post('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  return router;
}
