import { Router } from 'express';
import { requirePlayer } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';
import { buildWorldView, NoCharacterError } from '../../services/worldMapService.js';

export function createWorldMapRouter() {
  const router = Router();

  router.get('/api/mapamundi/vista', requirePlayer, handler(async (req, res) => {
    try {
      res.json(await buildWorldView(req.session.user.id));
    } catch (err) {
      if (err instanceof NoCharacterError) return res.status(409).json({ error: err.message });
      throw err;
    }
  }));

  return router;
}
