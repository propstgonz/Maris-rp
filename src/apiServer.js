import express from 'express';
import compression from 'compression';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';

import logger from './utils/logger.js';
import { isDatabaseReady, whenReady } from './database/index.js';
import { MysqlSessionStore, pruneExpiredSessions } from './services/mysqlSessionStore.js';
import { csrfSynchronisedProtection, generateToken } from './api/csrf.js';
import { PORT, PUBLIC_URL, SESSION_SECRET, STATIC_DIR } from './api/env.js';
import { startAuditPoller } from './api/state/auditPoller.js';

import { createAuthRouter } from './api/routes/auth.js';
import { createCoreRouter } from './api/routes/core.js';
import { createPlayersRouter } from './api/routes/players.js';
import { createStaffRouter } from './api/routes/staff.js';
import { createAuditLogRouter } from './api/routes/auditLog.js';
import { createTerminalRouter } from './api/routes/terminal.js';
import { createDocsRouter } from './api/routes/docsStaff.js';
import { createBackupsRouter } from './api/routes/backups.js';
import { createModmailCategoriesRouter } from './api/routes/modmailCategories.js';
import { createBroadcastRouter } from './api/routes/broadcast.js';

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

app.use(createPlayersRouter());
app.use(createStaffRouter());
app.use(createAuditLogRouter());
app.use(createTerminalRouter({ terminalLimiter }));
app.use(createDocsRouter());
app.use(createBackupsRouter());
app.use(createModmailCategoriesRouter());
app.use(createBroadcastRouter());

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(err.statusCode ?? 403).json({
      error: 'Token de seguridad caducado o ausente — recarga la página e inténtalo de nuevo.',
    });
  }
  logger.error(`[API] Error no capturado en ${req.method} ${req.path}: ${err.message}`);
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  logger.info(`[API] Escuchando en el puerto ${PORT} (público: ${PUBLIC_URL})`);
});

whenReady.then(async () => {
  await startAuditPoller();

  const SESSION_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(pruneExpiredSessions, SESSION_PRUNE_INTERVAL_MS);
});

export { app };
