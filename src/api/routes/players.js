import { Router } from 'express';
import { getAvatarUrl } from '../../utils/playerAvatar.js';
import { getPlayerByDiscordId, listPlayers } from '../../services/playerService.js';
import { getProfile } from '../../services/profileService.js';
import { listGrouped } from '../../services/npcHoldingService.js';
import { listInventory } from '../../services/goodsService.js';
import { listProperties } from '../../services/propertyService.js';
import { getSchoolsOverview, getUnlockedSpells } from '../../services/magicService.js';
import { requireRole } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';

const PAGE_SIZE = 100;

async function listAll(fetchPage) {
  const rows = [];
  for (let page = 1; ; page++) {
    const chunk = await fetchPage({ page, pageSize: PAGE_SIZE });
    rows.push(...chunk.rows);
    if (chunk.rows.length === 0 || rows.length >= chunk.total) return rows;
  }
}

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

  router.get('/api/players/:discordId/ficha', requireRole('isRolepriest'), handler(async (req, res) => {
    const player = await getPlayerByDiscordId(req.params.discordId);
    if (!player?.character_created_at) return res.status(404).json({ error: 'Ese jugador no tiene personaje.' });
    const id = player.id;
    const [profile, npcs, goods, properties, schools, spells] = await Promise.all([
      getProfile(id),
      listAll(opts => listGrouped(id, opts)),
      listAll(opts => listInventory(id, opts)),
      listAll(opts => listProperties(id, opts)),
      getSchoolsOverview(id),
      listAll(opts => getUnlockedSpells(id, opts)),
    ]);
    res.json({
      player: {
        id,
        discord_id: player.discord_id,
        character_name: player.character_name,
        gender: player.gender,
        age: player.age,
        character_created_at: player.character_created_at,
        is_alive: Boolean(player.is_alive),
        avatar_url: getAvatarUrl(player, '/api/players/:discordId'),
      },
      profile: {
        base: profile.base,
        effective: profile.effective,
        freePoints: profile.freePoints,
        race: profile.race,
        menhir: profile.menhir,
        magic: profile.magic,
        civil: profile.civil,
      },
      npcs,
      goods,
      properties,
      schools,
      spells,
    });
  }));

  return router;
}
