import { Router } from 'express';
import fs from 'fs';
import { requireAuth, requirePlayer } from '../middleware/auth.js';
import { STAFF_GUIDE_PATH, ROLEPLAY_GUIDE_PATH } from '../env.js';

export function createDocsRouter() {
  const router = Router();

  router.get('/api/docs/staff', requireAuth, (req, res) => {
    try {
      const content = fs.readFileSync(STAFF_GUIDE_PATH, 'utf8');
      res.json({ content });
    } catch {
      res.status(500).json({ error: 'No se pudo leer la guía de Staff.' });
    }
  });

  router.get('/api/docs/roleo', requirePlayer, (req, res) => {
    try {
      const content = fs.readFileSync(ROLEPLAY_GUIDE_PATH, 'utf8');
      res.json({ content });
    } catch {
      res.status(500).json({ error: 'No se pudo leer la guía de roleo.' });
    }
  });

  return router;
}
