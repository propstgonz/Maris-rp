import logger from '../../utils/logger.js';
import { UserFacingError } from '../../utils/errors.js';
import { hasKnownTranslation, translateMysqlError, looksLikeMysqlDriverError } from './dbErrors.js';

const OPAQUE_ERROR_NAMES = new Set(['TypeError', 'ReferenceError']);

export function handler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof UserFacingError) {
        return res.status(400).json({ error: err.message });
      }
      if (hasKnownTranslation(err)) {
        return res.status(400).json({ error: translateMysqlError(err) });
      }
      if (OPAQUE_ERROR_NAMES.has(err?.name) || looksLikeMysqlDriverError(err)) {
        logger.error(`[API] Error interno en ${req.method} ${req.path}: ${err.stack ?? err.message}`);
        return res.status(500).json({ error: 'Error interno del servidor.' });
      }
      res.status(400).json({ error: err.message });
    }
  };
}
