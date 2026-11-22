# ENGINEERING STANDARDS & ARCHITECTURE DIRECTIVES: rpdiscbot

Monorepo de alto rendimiento para Bot de Discord y Panel Web SSR de Administración de Roleplay.

**Las directrices completas y actualizadas viven en [CLAUDE.md](./CLAUDE.md), en la raíz del repo — léelo entero antes de tocar código.** Este fichero es solo el resumen mínimo para agentes que no cargan `CLAUDE.md` por convención propia.

Correcciones críticas frente a versiones anteriores de este mismo fichero: la base de datos **no es SQLite** — es **MySQL** (`mysql2/promise`), en cuatro schemas por dominio (`rp_players`, `rp_world`, `rp_economy`, `rp_ops`, ver `src/database/tables.js`), accedida solo vía `query()`/`queryOne()`/`execute()`/`withTransaction()` de `src/database/index.js`. No hay `db.transaction()` ni modo WAL.

## Entorno y protocolo de seguridad
- Windows + PowerShell, formato de archivo **LF** estricto (nunca CRLF).
- Pide confirmación explícita antes de: comandos destructivos (`git reset --hard`, `git clean -fd`, `docker system prune`), `DROP`/`DELETE` masivos, despliegues o reinicios en producción.
- `git push` es siempre del usuario — deja el trabajo en commits locales.
- Nunca leas `node_modules`, `.astro` ni carpetas de build.

## Principios de ingeniería
- Migraciones versionadas en `src/database/migrations/mysql/*.sql`, registradas en `FILE_SCHEMA` (`src/database/migrate.js`) — nunca editar una ya aplicada.
- Cero emojis en `apps/web/` (usar `icon()` de `apps/web/src/lib/icons.ts`); el bot de Discord (`src/`) sí los usa, es su lenguaje de iconografía nativo.
- Todo `innerHTML` pasa por `escapeHtml()`/`escapeAttr()` (`apps/web/src/scripts/html.ts`); toda mutación de cliente usa `apiFetch()` (`apps/web/src/scripts/api.ts`).
- Prohibido dejar `TODO`/`FIXME` sin resolver o código muerto. Cero comentarios nuevos en el código — las explicaciones van al mensaje del commit.

## Estructura del repositorio
- Bot de Discord: `src/` (comandos en `src/commands/`, lógica en `src/services/`).
- Servidor Express / API web: `src/mapServer.js`, `src/mapServer/routes/`.
- Panel web (Astro): `apps/web/src/pages/`, `apps/web/src/scripts/`, `apps/web/src/lib/`.

## Comandos de desarrollo
- Dev Frontend: `npm run dev --workspace=apps/web`
- Build Frontend: `npm run build --workspace=apps/web`
- Docker Local: `docker compose up -d --build`
- Logs de Servicio: `docker compose logs --tail=50 <servicio>`
- Tests: `npm test`
