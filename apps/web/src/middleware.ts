import { defineMiddleware } from 'astro:middleware';

const SKIP_PREFIXES = ['/_astro/', '/favicon'];

export interface SessionUser {
  id: string;
  username: string;
  avatar: string | null;
  isRolepriest: boolean;
  hasCharacter: boolean;
  maxRangeTiles: number;
  csrfToken: string;
  idleLogoutMinutes: number;
}

declare global {
  namespace App {
    interface Locals {
      user: SessionUser | null;
      apiBase: string;
    }
  }
}

const MAP_SERVER_INTERNAL_URL = (process.env.MAP_SERVER_INTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.apiBase = MAP_SERVER_INTERNAL_URL;

  if (SKIP_PREFIXES.some(p => context.url.pathname.startsWith(p))) {
    context.locals.user = null;
    return next();
  }

  const cookie = context.request.headers.get('cookie');
  context.locals.user = cookie ? await resolveSession(cookie) : null;

  return next();
});

const RETRY_DELAY_MS = 200;
const SESSION_TIMEOUT_MS = 5000;

async function resolveSession(cookie: string): Promise<SessionUser | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${MAP_SERVER_INTERNAL_URL}/api/me`, {
        headers: { cookie },
        signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      if (res.status < 500) return null;

      if (attempt === 2) {
        console.warn(`[middleware] /api/me devolvió ${res.status} incluso tras reintentar — sesión tratada como inválida.`);
        return null;
      }
    } catch (err) {
      if (attempt === 2 || (err as Error).name === 'TimeoutError') {
        console.error(`[middleware] No se pudo resolver la sesión vía ${MAP_SERVER_INTERNAL_URL}/api/me: ${(err as Error).message}`);
        return null;
      }
    }
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }

  return null;
}
