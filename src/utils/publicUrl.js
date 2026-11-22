

import logger from './logger.js';

const NGINX_BASE = process.env.NGINX_BASE_URL?.replace(/\/$/, '') ?? '';

export function looksPubliclyReachable(candidate) {
  let u;
  try {
    u = new URL(candidate);
  } catch {
    return false;
  }
  const host = u.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
  if (!host.includes('.')) return false;
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

export function buildAssetUrl(relativePath, logContext = 'publicUrl') {
  if (!NGINX_BASE || !relativePath) return null;

  const cleanPath = relativePath.replace(/^\/+/, '');
  const candidate = `${NGINX_BASE}/${cleanPath}`;

  if (looksPubliclyReachable(candidate)) {
    return candidate;
  }

  logger.warn(
    `[${logContext}] NGINX_BASE_URL ("${NGINX_BASE}") no parece alcanzable desde fuera ` +
    `(¿nombre interno de Docker o localhost?), se omite la URL pública para "${relativePath}".`
  );
  return null;
}
