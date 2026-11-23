# ENGINEERING STANDARDS & ARCHITECTURE DIRECTIVES: rpdiscbot

Monorepo del bot de Discord de fichas del Tomegrama y su panel web SSR de Staff.

**Las directrices completas y actualizadas viven en [CLAUDE.md](./CLAUDE.md), en la raíz del repo — léelo entero antes de tocar código.** Este fichero es solo el resumen mínimo para agentes que no cargan `CLAUDE.md` por convención propia.

La base de datos es **MySQL** (`mysql2/promise`), en cuatro schemas por dominio (`rp_players`, `rp_world`, `rp_economy`, `rp_ops`, ver `src/database/tables.js`), accedida solo vía `query()`/`queryOne()`/`execute()`/`withTransaction()` de `src/database/index.js`. No hay SQLite ni `db.transaction()`.

## Entorno y protocolo de seguridad
- Windows + PowerShell, formato de archivo **LF** estricto (nunca CRLF).
- Pide confirmación explícita antes de: comandos destructivos (`git reset --hard`, `git clean -fd`, `docker system prune`), `DROP`/`DELETE` masivos, despliegues o reinicios en producción.
- `git push` es siempre del usuario — deja el trabajo en commits locales.
- Nunca leas `node_modules`, `.astro` ni carpetas de build.

## Principios de ingeniería
- Migraciones versionadas en `src/database/migrations/mysql/*.sql` (el schema se deduce del nombre `NNN_rp_<schema>_<tema>.sql`) — nunca editar una ya aplicada.
- Bloquea primero las filas de `players` en orden ascendente de id; reclama límites y cooldowns con un único `UPDATE` con la guarda en el `WHERE`; un traspaso es una sola transacción.
- Un Rolepriest no actúa sobre su propio personaje.
- Cero emojis en `apps/web/` (usar `icon()` de `apps/web/src/lib/icons.ts`); el bot de Discord (`src/`) sí los usa, es su lenguaje de iconografía nativo.
- Todo `innerHTML` pasa por `escapeHtml()` (`apps/web/src/scripts/html.ts`); toda mutación de cliente usa `apiFetch()` (`apps/web/src/scripts/api.ts`).
- Prohibido dejar `TODO`/`FIXME` sin resolver o código muerto. Cero comentarios nuevos en el código — las explicaciones van al mensaje del commit.
- `mock.module()` en los tests: siempre `defaultExport`/`namedExports`, nunca `exports`.

## Estructura del repositorio
- Bot de Discord: `src/` (comandos en `src/commands/player/` y `src/commands/staff/`, lógica en `src/services/`, reglas puras en `src/domain/`).
- API del panel (Express, solo API): `src/apiServer.js`, `src/api/`.
- Panel web (Astro): `apps/web/src/pages/`, `apps/web/src/scripts/`, `apps/web/src/lib/`.
- Documentación: `README.md`, `docs/` (`ARQUITECTURA.md`, `COMANDOS.md`, `ADR.md`, `TRAZABILIDAD.md`, `deploy.md`, `migration.md`, `guia-staff.md`).

## Comandos de desarrollo
- Dev Frontend: `npm run dev --workspace=apps/web`
- Build Frontend: `npm run build --workspace=apps/web`
- Docker Local: `docker compose up -d --build`
- Logs de Servicio: `docker compose logs --tail=50 <servicio>`
- Tests: `npm test` (unit + comandos + smoke); `npm run test:integration` contra una MySQL desechable (ver `CLAUDE.md`).
