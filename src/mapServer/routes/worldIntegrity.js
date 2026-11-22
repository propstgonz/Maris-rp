import { Router } from 'express';
import { runWorldIntegrityChecks } from '../../services/worldIntegrityService.js';
import { requireAuth } from '../middleware/auth.js';
import { handler } from '../utils/handler.js';

export function createWorldIntegrityRouter() {
  const router = Router();

  router.get('/api/world-integrity', requireAuth, handler(async (req, res) => {
    res.json(await runWorldIntegrityChecks());
  }));

  return router;
}
