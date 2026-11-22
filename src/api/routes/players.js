import { Router } from 'express';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import { getPlayerByDiscordId, listPlayers } from '../../services/playerService.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';

export function createPlayersRouter() {
  const router = Router();

  router.get('/api/players', requireRole('isRolepriest'), handler(async (req, res) => {
    const players = await listPlayers();
    res.json(players.map(p => ({ ...p, avatar_url: getAvatarUrl(p, '/api/players/:discordId') })));
  }));

  router.get('/api/players/:discordId', requireRole('isRolepriest'), handler(async (req, res) => {
    const player = await getPlayerByDiscordId(req.params.discordId);
    if (!player) return res.status(404).json({ error: 'No se encontraron datos de ese jugador.' });
    res.json({ ...player, avatar_url: getAvatarUrl(player, '/api/players/:discordId') });
  }));

  return router;
}
