import { Router } from 'express';
import fs from 'fs';
import { requireAuth } from '../middleware/auth.js';
import { STAFF_GUIDE_PATH } from '../env.js';

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

  return router;
}
