import logger from '../../utils/logger.js';
import { getSetting, setSetting } from '../../services/settingsService.js';

const IDLE_LOGOUT_SETTING_KEY = 'web_idle_logout_minutes';
const DEFAULT_IDLE_LOGOUT_MINUTES = 30;

export async function getIdleLogoutMinutes() {
  const raw = Number(await getSetting(IDLE_LOGOUT_SETTING_KEY, String(DEFAULT_IDLE_LOGOUT_MINUTES)));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_LOGOUT_MINUTES;
}

export async function setIdleLogoutMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('Los minutos de inactividad deben ser un número mayor que 0.');
  }
  await setSetting(IDLE_LOGOUT_SETTING_KEY, String(minutes));
}

export function sessionCookieFingerprint(req) {
  const match = req.headers?.cookie?.match(/connect\.sid=([^;]+)/);
  return match ? match[1].slice(-12) : null;
}

export async function isSessionActive(req) {
  if (!req.session?.user) return false;
  const idleLogoutMs = (await getIdleLogoutMinutes()) * 60 * 1000;
  if (Date.now() - (req.session.lastActivity ?? 0) > idleLogoutMs) return false;
  if (req.get('X-Passive-Refresh') !== '1') req.session.lastActivity = Date.now();
  return true;
}

function unauthorized(req, res) {
  const hadSession = !!req.session?.user;
  const fingerprint = sessionCookieFingerprint(req);
  if (!hadSession && fingerprint) {
    logger.warn(`[MapServer] 401 con cookie de sesión presente (cookie:...${fingerprint}) — sesión no encontrada o caducada.`);
  }
  return res.status(401).json({
    error: hadSession ? 'Sesión expirada por inactividad — vuelve a iniciar sesión.' : 'No has iniciado sesión.',
  });
}

export async function requireSession(req, res, next) {
  if (!(await isSessionActive(req))) return unauthorized(req, res);
  next();
}

export async function requireAuth(req, res, next) {
  if (!(await isSessionActive(req))) return unauthorized(req, res);
  if (!req.session.user.isRolepriest) {
    return res.status(403).json({ error: 'Esta parte del sitio es solo para Rolepriests.' });
  }
  next();
}

export async function requirePlayer(req, res, next) {
  if (!(await isSessionActive(req))) return unauthorized(req, res);
  if (!req.session.user.hasCharacter) {
    return res.status(403).json({
      error: 'Todavía no tienes personaje. Créalo en la página principal, o en Discord con /personaje crear.',
    });
  }
  next();
}

export function requireRole(role) {
  return async (req, res, next) => {
    const hadSession = !!req.session?.user;
    if (!(await isSessionActive(req))) {
      return res.status(401).json({ error: hadSession ? 'Sesión expirada por inactividad — vuelve a iniciar sesión.' : 'No has iniciado sesión.' });
    }
    if (!req.session.user[role]) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    }
    next();
  };
}
