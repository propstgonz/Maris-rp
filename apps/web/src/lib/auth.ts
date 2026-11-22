import type { AstroGlobal } from 'astro';
import type { SessionUser } from '../middleware';

export function requireUser(Astro: AstroGlobal): SessionUser | Response {
  if (Astro.locals.user) return Astro.locals.user;
  return Astro.redirect('/auth/login');
}

export function requireRolepriest(Astro: AstroGlobal): SessionUser | Response {
  const guard = requireUser(Astro);
  if (guard instanceof Response) return guard;
  if (!guard.isRolepriest) {
    return new Response('No tienes permiso para ver esta página.', { status: 403 });
  }
  return guard;
}
