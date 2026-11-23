import logger from '../../utils/logger.js';
import { getSetting } from '../../services/settingsService.js';
import { ROLE_ROLEPRIEST } from '../../utils/permissions.js';

const IDLE_LOGOUT_SETTING_KEY = 'web_idle_logout_minutes';
const DEFAULT_IDLE_LOGOUT_MINUTES = 30;

export async function getIdleLogoutMinutes() {
  const raw = Number(await getSetting(IDLE_LOGOUT_SETTING_KEY, String(DEFAULT_IDLE_LOGOUT_MINUTES)));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDLE_LOGOUT_MINUTES;
}

export function sessionCookieFingerprint(req) {
  const match = req.headers?.cookie?.match(/connect\.sid=([^;]+)/);
  return match ? match[1].slice(-12) : null;
}

const ROLE_RECHECK_MS = 10 * 60 * 1000;

export async function fetchMemberRoles(userId) {
  const res = await fetch(`https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Discord devolvió ${res.status} al leer la membresía.`);
  return (await res.json()).roles ?? [];
}

export async function revalidateRolepriest(req, { fetchRoles = fetchMemberRoles } = {}) {
  const user = req.session.user;
  if (!user.isRolepriest) return true;
  if (Date.now() - (req.session.roleCheckedAt ?? 0) < ROLE_RECHECK_MS) return true;
  try {
    const roles = await fetchRoles(user.id);
    if (!roles?.some(r => ROLE_ROLEPRIEST.includes(r))) return false;
    req.session.roleCheckedAt = Date.now();
  } catch (err) {
    logger.warn(`[API] No se pudo revalidar el rol de ${user.id}: ${err.message}`);
  }
  return true;
}

export async function isSessionActive(req) {
  if (!req.session?.user) return false;
  const idleLogoutMs = (await getIdleLogoutMinutes()) * 60 * 1000;
  if (Date.now() - (req.session.lastActivity ?? 0) > idleLogoutMs) return false;
  if (!await revalidateRolepriest(req)) {
    await new Promise(resolve => req.session.destroy(resolve));
    return false;
  }
  if (req.get('X-Passive-Refresh') !== '1') req.session.lastActivity = Date.now();
  return true;
}

function unauthorized(req, res) {
  const hadSession = !!req.session?.user;
  const fingerprint = sessionCookieFingerprint(req);
  if (!hadSession && fingerprint) {
    logger.warn(`[API] 401 con cookie de sesión presente (cookie:...${fingerprint}) — sesión no encontrada o caducada.`);
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
