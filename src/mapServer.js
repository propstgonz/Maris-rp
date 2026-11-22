import express from 'express';
import compression from 'compression';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';

import logger from './utils/logger.js';
import { isDatabaseReady, whenReady } from './database/index.js';
import { MysqlSessionStore, pruneExpiredSessions } from './services/mysqlSessionStore.js';
import { MAX_IMAGE_SIZE_BYTES } from './utils/imageUpload.js';
import { csrfSynchronisedProtection, generateToken } from './mapServer/csrf.js';
import { PORT, PUBLIC_URL, SESSION_SECRET, STATIC_DIR } from './mapServer/env.js';
import { refreshMapCache, MAP_CACHE_REFRESH_MS } from './mapServer/state/mapCache.js';
import { startAuditPoller } from './mapServer/state/auditPoller.js';

import { createAuthRouter } from './mapServer/routes/auth.js';
import { createCoreRouter } from './mapServer/routes/core.js';
import { createTilesRouter } from './mapServer/routes/tiles.js';
import { createTerrainTypesRouter } from './mapServer/routes/terrainTypes.js';
import { createZonesRouter } from './mapServer/routes/zones.js';
import { createSettingsRouter } from './mapServer/routes/settings.js';
import { createWorldIntegrityRouter } from './mapServer/routes/worldIntegrity.js';
import { createItemsRouter } from './mapServer/routes/items.js';
import { createItemCategoriesRouter } from './mapServer/routes/itemCategories.js';
import { createConstructionTypesRouter } from './mapServer/routes/constructionTypes.js';
import { createEffectTypesRouter } from './mapServer/routes/effectTypes.js';
import { createNpcsRouter } from './mapServer/routes/npcs.js';
import { createFactionsRouter } from './mapServer/routes/factions.js';
import { createPlayersRouter } from './mapServer/routes/players.js';
import { createStaffRouter } from './mapServer/routes/staff.js';
import { createAuditLogRouter } from './mapServer/routes/auditLog.js';
import { createImagesRouter } from './mapServer/routes/images.js';
import { createTerminalRouter } from './mapServer/routes/terminal.js';
import { createDocsRouter } from './mapServer/routes/docsStaff.js';
import { createBackupsRouter } from './mapServer/routes/backups.js';
import { createModmailCategoriesRouter } from './mapServer/routes/modmailCategories.js';
import { createBroadcastRouter } from './mapServer/routes/broadcast.js';
import { createWorldMapRouter } from './mapServer/routes/worldMap.js';
import { createGameRouter } from './mapServer/routes/game.js';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },

  crossOriginEmbedderPolicy: false,
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const terminalLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const avatarLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

app.use((req, res, next) => {
  if (isDatabaseReady()) return next();
  const message = 'La aplicación se está iniciando (base de datos arrancando) — vuelve a intentarlo en unos segundos.';
  if (req.accepts(['html', 'json']) === 'html') {
    res.status(503).type('html').send(
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Iniciando…</title>` +
      `<meta http-equiv="refresh" content="5"></head><body style="font-family:system-ui,sans-serif;` +
      `display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#14151a;color:#e8e8ec">` +
      `<p>${message}</p></body></html>`
    );
  } else {
    res.status(503).json({ error: message });
  }
});

app.use(compression({
  filter: (req, res) => (req.path === '/api/events' ? false : compression.filter(req, res)),
}));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: new MysqlSessionStore(),
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(csrfSynchronisedProtection);

app.use('/static', express.static(STATIC_DIR));

app.use(createAuthRouter({ authLimiter }));
app.use(createCoreRouter({ generateToken, avatarLimiter }));

app.use(createTilesRouter());
app.use(createTerrainTypesRouter());
app.use(createZonesRouter());
app.use(createSettingsRouter());
app.use(createWorldIntegrityRouter());
app.use(createItemsRouter());
app.use(createItemCategoriesRouter());
app.use(createConstructionTypesRouter());
app.use(createEffectTypesRouter());
app.use(createNpcsRouter());
app.use(createFactionsRouter());
app.use(createPlayersRouter());
app.use(createStaffRouter());
app.use(createAuditLogRouter());
app.use(createImagesRouter());
app.use(createTerminalRouter({ terminalLimiter }));
app.use(createDocsRouter());
app.use(createBackupsRouter());
app.use(createModmailCategoriesRouter());
app.use(createBroadcastRouter());

app.use(createWorldMapRouter());
app.use(createGameRouter());

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `La imagen pesa más de ${(MAX_IMAGE_SIZE_BYTES / 1024 / 1024).toFixed(0)} MB.`
      : `Error subiendo el archivo: ${err.message}`;
    return res.status(400).json({ error: message });
  }

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(err.statusCode ?? 403).json({
      error: 'Token de seguridad caducado o ausente — recarga la página e inténtalo de nuevo.',
    });
  }
  logger.error(`[MapServer] Error no capturado en ${req.method} ${req.path}: ${err.message}`);
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  logger.info(`[MapServer] ✔ Escuchando en el puerto ${PORT} (público: ${PUBLIC_URL})`);
});

whenReady.then(async () => {
  await refreshMapCache();
  setInterval(refreshMapCache, MAP_CACHE_REFRESH_MS);

  await startAuditPoller();

  const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(pruneExpiredSessions, SESSION_PRUNE_INTERVAL_MS);
});

export { app };
