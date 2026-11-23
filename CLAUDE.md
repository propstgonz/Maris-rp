# ENGINEERING STANDARDS & ARCHITECTURE DIRECTIVES: rpdiscbot

Monorepo del bot de Discord de fichas del Tomegrama (personajes, PICARDA, razas, menhires, matrimonio, inventarios y magia) y su panel web SSR de Staff. La fuente de verdad de las mecánicas es `PROMPT/El Tomegrama.pdf`; las decisiones y ambigüedades están en `docs/ADR.md`, la arquitectura en `docs/ARQUITECTURA.md` y la correspondencia mecánica-código-test en `docs/TRAZABILIDAD.md`.

---

## MODEL SELECTION & ROUTING (Gestión de Modelos)
- **Claude Haiku / Fast**: Inspección rápida de logs, búsquedas de contexto, verificación de tipos, formato y scripts simples de lectura.
- **Claude Sonnet**: Desarrollo diario, refactorización de lógica, integración de APIs, modificación de endpoints, comandos y componentes de Discord, componentes Astro.
- **Claude Opus**: Diseños arquitectónicos complejos, cambios estructurales multi-módulo y resolución de bugs críticos de concurrencia/persistencia.

---

## ENTORNO DE EJECUCIÓN & HERRAMIENTAS (Windows / VS Code)
- **SO & Terminal**: Windows OS usando PowerShell (`PS C:\Windows\System32>`).
- **Formato de Archivos**: Formato estricto **LF** (`\n`). NUNCA guardar o convertir a CRLF (`\r\n`).
- **Prevención de Archivos Basura / Rutas Windows**:
  - Queda prohibida la creación de archivos o carpetas con prefijos como `;C` o rutas mal escapadas.
  - Al ejecutar comandos de terminal en PowerShell, asegura el uso correcto de comillas dobles y escapado de variables/rutas (`./path/to/file` o `"C:\path\..."`).
- **Docker Desktop**: Si la pila containerizada no responde, arranca Docker Desktop de forma autónoma antes de reintentar.
- **Despliegue Remoto**: Autorizado el uso de `.\ssh_server.bat` para operaciones en el servidor de producción.

---

## PROTOCOLO DE SEGURIDAD Y CONTROL DE DAÑOS
1. **Confirmación Obligatoria**: Pide confirmación explícita del usuario antes de ejecutar:
   - Comandos destructivos (`git reset --hard`, `git clean -fd`, `docker system prune`).
   - Modificaciones destructivas masivas en base de datos (`DROP`, `DELETE` masivos).
   - Despliegues o reinicios en entorno de producción.
2. **`git push` es SIEMPRE del usuario, nunca tuyo.** Deja el trabajo terminado en commits locales (mensaje claro, en el idioma habitual del repo) y para ahí — el usuario decide cuándo y qué sube. No ejecutes `git push` bajo ningún contexto, ni aunque el propio usuario esté a mitad de un despliegue y parezca el siguiente paso obvio.
3. **Eficiencia de Contexto**:
   - Analiza el problema y traza un plan breve ANTES de editar código.
   - NUNCA leas `node_modules`, `.astro` ni carpetas de build.
   - Responde con diffs precisos o parches de código en lugar de reimprimir archivos masivos completos.

---

## PRINCIPIOS DE INGENIERÍA DE SOFTWARE (Anti-Vibecoding)
1. **Contratos de Interfaz e Invariantes**:
   - En `apps/web/` (TypeScript) todo módulo debe exportar tipos estrictos. `src/` es JavaScript plano y **sin JSDoc** — el contrato de un servicio lo fija su nombre, sus validaciones y su test, no un bloque de tipos que nadie comprueba y que envejece solo. Los contratos exactos de cada servicio están en `docs/ARQUITECTURA.md`.
   - **MySQL (`mysql2/promise`) en cuatro schemas por dominio es la única fuente de verdad**: `rp_players`, `rp_world`, `rp_economy`, `rp_ops` (nombres cualificados centralizados en `src/database/tables.js`, módulo `T`). Las FK solo se declaran DENTRO de cada schema — las relaciones que cruzan schemas (`inventory.player_id`, `properties.owner_player_id`) se garantizan en la capa de aplicación, nunca con una FK real.
   - Todo acceso a datos pasa por el contrato de `src/database/index.js`: `query()`, `queryOne()`, `execute()`, `withTransaction(fn, { retryOnDeadlock })`. Las transacciones usan `AsyncLocalStorage` (no un parámetro de conexión pasado a mano) — `withTransaction()` deja la conexión activa en un contexto ambiente y `query`/`execute` la recogen solos si existe. Nunca reintroducir el patrón "pasar la conexión como argumento".
   - `withTransaction()` es reentrante: si ya hay una transacción abierta se une a ella en vez de anidar otra (y entonces `retryOnDeadlock` no hace nada: solo reintenta la transacción más externa si la pidió). **Nunca lances una promesa sin `await` dentro de un `withTransaction`**: hereda la conexión por el mismo `AsyncLocalStorage` y puede acabar usándola después del `commit`. Si algo tiene que ser "dispara y olvida" (un `logAction`, un aviso), sácalo fuera del bloque. `logAction({ actor, ... })` se llama después del commit.
   - **`execute()` devuelve `changes` = filas ENCONTRADAS, no filas cambiadas.** mysql2 conecta con `CLIENT_FOUND_ROWS`, así que un `UPDATE` que deja la fila igual sigue devolviendo 1. Consecuencia práctica: una condición de guarda tiene que ir en el `WHERE`, nunca en un `IF()` dentro del `SET` — con `IF()` la guarda parece funcionar y no funciona. Cualquier `changes === 0` que uses como "no se pudo" debe apoyarse en un `WHERE` que realmente no case.
   - **Orden de bloqueos**: toda transacción que toque a más de un jugador bloquea primero las filas de `players` en orden ascendente de id (`lockPlayersInTx()` de `playerService.js`, `lockCoupleInTx()` para la pareja) y después el resto de tablas. Dos transacciones que toman los mismos bloqueos en orden distinto acaban en deadlock.
   - **Un índice secundario que contiene una columna con FK hace que actualizar OTRA columna de ese índice tome bloqueos S sobre la tabla padre.** Pasó con `consent_requests(to_player_id, status)`: cada cambio de `status` bloqueaba filas de `players` y producía deadlocks. Los índices de columnas con FK se declaran solo sobre la columna FK (`idx_to (to_player_id)`, `idx_from (from_player_id)`).
   - **Deadlocks**: las operaciones que el diseño sabe que pueden chocar (aceptar una solicitud, matar un personaje) usan `withTransaction(fn, { retryOnDeadlock: 3 })`. Si el deadlock persiste tras los reintentos, llega al usuario como `UserFacingError` ("Hubo un choque con otra operación, inténtalo de nuevo"), nunca como un error crudo de MySQL.
   - **Migraciones de esquema** versionadas en `src/database/migrations/mysql/*.sql` (tabla `rp_ops.schema_migrations`, runner en `src/database/migrate.js`) — un fichero nuevo por cambio de esquema, nunca editar uno ya aplicado. El schema se deduce del nombre del fichero (`NNN_rp_<schema>_<tema>.sql`). Bot y API migran al arrancar, así que el runner se serializa con `GET_LOCK('rp_migrations')` (espera hasta 600 s): sin ese bloqueo dos procesos aplican la misma migración a la vez.
   - **Los catálogos de razas, menhires, escuelas, niveles de dominio y conjuros se siembran en migraciones con el texto literal del PDF.** Cualquier cambio de mecánica o de texto va en una migración nueva (un `UPDATE`), nunca editando la que lo sembró y nunca desde código de aplicación.
   - Los enteros ya validados se interpolan en `LIMIT`/`OFFSET` por coherencia con el resto de servicios (`goodsService`, `magicService`); `LIMIT ?` con parámetro también funciona en mysql2 3 (`auditLogService` lo usa).
2. **Desacoplamiento Estructural**:
   - Prohibido acoplar lógica del bot de Discord dentro del frontend SSR o viceversa. Bot, API (`src/apiServer.js` + `src/api/`) y web SSR (`apps/web`) son **tres procesos que solo comparten MySQL** — ninguno puede llamar a una función del otro.
   - La API es la única que habla con el navegador; la web solo hace `fetch()` server-side contra ella (`API_INTERNAL_URL`). Su configuración vive en variables `API_*` (`API_PUBLIC_URL`, `API_SESSION_SECRET`, `API_PORT`).
   - Un único canal SSE, `/api/events`, solo para Rolepriest (`requireAuth`); lo alimenta `src/api/state/auditPoller.js` leyendo `rp_ops.audit_log`.
   - Cuando la API necesita algo que exige el cliente de Discord (un MD, mandar un broadcast, ejecutar un comando desde el terminal), no lo hace: encola un `bot_job` (`botJobService`) o un `terminal_job` (`terminalJobService`) y el proceso del bot lo ejecuta. Nunca pasar `client = null` y esperar que el servicio se apañe.
   - Toda acción que cambia el estado de un jugador escribe una fila en `rp_ops.audit_log` con `logAction({ actor, action, target, details })`, donde `actor = { discordId, username, source: 'discord' | 'web' }`.
3. **Manejo Riguroso de Errores & XSS**:
   - Todo `innerHTML` debe pasar obligatoriamente por `escapeHtml()` (`apps/web/src/scripts/html.ts`).
   - Toda mutación cliente debe usar `apiFetch()` (`apps/web/src/scripts/api.ts`) asegurando la validación del token CSRF.
   - Los servicios lanzan `UserFacingError` (`src/utils/errors.js`) para todo rechazo de regla; su mensaje es el que ve el jugador.
4. **Mantenibilidad y Limpieza**:
   - Prohibido dejar comentarios `TODO` sin resolver o código muerto comentado.
   - Aplica el principio DRY: extrae lógica repetida a utilidades puras y aisladas. Un solo kit de confirmación y paginación para toda la interfaz de Discord: `confirmAction()` de `src/components/confirm.js` y `src/utils/paginate.js`.
   - **Cero comentarios nuevos en el código, sin excepción** — ni QUÉ hace (ya lo dicen los nombres) ni POR QUÉ. Si una restricción oculta o un workaround necesita quedar explicado, va en el mensaje del commit, en este fichero, en `docs/ADR.md` o en la respuesta al usuario, nunca en el código. Al editar un fichero, aprovecha para quitar cualquier comentario que ya exista ahí, sea del tipo que sea (JSDoc incluido). El repo está **a cero**: no queda ni un comentario de código.
   - Si hace falta purgar comentarios en masa otra vez: hazlo con el parser de TypeScript (`apps/web/node_modules/typescript`), localizando rangos por AST **y** por scanner, descartando los que caen dentro de literales (`https://…` en una plantilla se lee como comentario de línea), y verificando fichero a fichero que el flujo de tokens es idéntico antes y después. A ojo o con regex suelta se rompe código en silencio.

---

## MODERACIÓN, PERMISOS Y REGLAS DEL TOMEGRAMA
1. **Un solo rol de moderación: Rolepriest.**
   - Se identifica por los IDs de `config.json` → `roles.staff` (`isRolepriest()`/`requireRolepriest()` en `src/utils/permissions.js`). O eres Rolepriest o eres jugador: no reintroducir niveles intermedios.
   - En la sesión web el campo es `isRolepriest` (ver `apps/web/src/middleware.ts` y `src/api/routes/auth.js`). La API revalida el rol contra Discord cada 10 minutos (`revalidateRolepriest`) y cierra la sesión por `POST /auth/logout`.
   - **Un Rolepriest no actúa sobre su propio personaje** (Reglamento al Lorepriest, regla 2): `rejectSelfTarget()`/`requireOtherTarget()` en `src/utils/interactionContext.js` para las altas, bajas y correcciones; `/magia-admin` lo comprueba por su cuenta. Un comando de moderación nuevo que reciba un jugador como objetivo debe aplicar la misma guarda.
2. **Los jugadores solo ven lo suyo** (Reglamento al Usuario, regla 3). Las consultas son efímeras; solo un Rolepriest pasa `jugador:` para ver a otro (`resolveViewTarget()`).
3. **Los conjuros desbloqueados se derivan, nunca se guardan**: salen de `school_progress.level_rank` y `spells.min_rank` (`magicService.getUnlockedSpells`). No añadir una tabla de desbloqueos. Tampoco se guardan la estadística efectiva, los puntos libres, la Magia ni el estado civil: se calculan (`src/domain/`).
4. **Muerte**: al salir del servidor el personaje entra en *gracia* de 7 días (`enterGraceDeath`, nada se vacía; `/revive` o volver al servidor lo devuelve intacto). La muerte definitiva (`/kill`, o vencer la gracia con el cron de las 00:30 UTC) vacía los tres inventarios, las estadísticas, la raza, el menhir y el progreso mágico en una transacción, deja la instantánea en `audit_log` y arranca la espera de 336 h para crear otro personaje, contada desde `died_at`.
5. **Alcance**: el rediseño eliminó el mapa, las facciones y su sistema de permisos, el combate, la economía y el resto del juego antiguo (ADR-01, ADR-02). No reintroducirlos ni dejar rastros de ellos en código nuevo.

---

## REGLAS DE JUGABILIDAD (invariantes, no estilo)

Cada regla es un patrón que ya falló de verdad en este repo, no una precaución teórica. Desde que la web y Discord son dos frentes sobre la misma partida, dos peticiones simultáneas no son teóricas.

1. **Un límite o un cooldown nunca se comprueba y luego se escribe.** Se reclama en una sola sentencia atómica cuyo rechazo es `changes === 0`, con la guarda en el `WHERE`. Ejemplos a copiar: `profileService.allocateStat` (el tope de 6 por estadística y los puntos libres van en el `WHERE`), `chooseMenhir` (`menhir_chosen_at <= NOW() - INTERVAL 6 MONTH`), el `claimRoll` de `magicService.authorizedRoll` (nivel actual y `retry_after`), `claimFreeSchool`.
2. **Mover algo de un dueño a otro es una sola transacción.** "Quitárselo a A" y "dárselo a B" en dos pasos sueltos destruye el objeto en cuanto el segundo falla. `goodsService.transferGoodsInTx`, `npcHoldingService.transferNpcsInTx` y `propertyService.transferPropertyInTx` son los traspasos; se ejecutan dentro de `consentService.accept` (jugador a jugador, el destinatario acepta) o de los `admin*Transfer` (Rolepriest).
3. **Un ID que llega de fuera no prueba nada.** Todo comando o ruta que reciba el ID de un bien, una propiedad o una solicitud comprueba por su cuenta que pertenece a quien lo pide, y la guarda decisiva va en el `WHERE` de la escritura además de en el `if`. Ejemplos: `consentService.accept` (`to_player_id = actor` en el `WHERE` del claim), `propertyService.revokeProperty(id, expectedOwnerId, actor)`, `removeGoods`/`removeNpcs` (exigen `changes === count`).
4. **Lo que cuesta jugar se cobra cuando la acción ocurre, no antes.** La reclamación del turno, del enfriamiento o de la escuela gratuita va DENTRO de la misma transacción que su efecto (`authorizedRoll` reclama, tira, ascende y registra el intento en una transacción); si el efecto falla, la reclamación se deshace con él.
5. **La tirada de ascenso la hace el bot, la autoriza un Rolepriest** (`authorizedRoll`): el jugador no puede tirar por su cuenta. El umbral y el mentor salen de `mastery_levels`, no de constantes.

---

## DISEÑO E INTERFAZ PROFESIONAL (Enterprise UI/UX)
1. **Cero Emojis (No Emojis) — en el PANEL WEB**:
   - Queda estrictamente prohibido usar emojis en componentes, botones, avisos, logs o código visual **de la web (`apps/web/`)**.
   - Toda la iconografía debe implementarse mediante SVG vectoriales limpios usando la librería interna `icon()` (`apps/web/src/lib/icons.ts`).
   - **Excepción explícita: el bot de Discord (`src/`).** Discord no admite SVG ni CSS propio — el emoji ES su lenguaje de iconografía nativo (`setEmoji()` en botones, `emoji:` en opciones de desplegable, embeds; catálogo en `src/utils/emoji.js`). Se usan con la misma disciplina que los SVG en la web: uno por concepto, consistente entre flujos, nunca decorativos ni repetidos en la misma línea.
   - Los documentos Markdown del repo no llevan emojis.
2. **Estética terminal (Fallout / Pip-Boy), no monocroma**:
   - Modo único, sin alternancia claro/oscuro: casi-negro de fondo, tipografía monoespaciada (`--sans`/`--mono` apuntan a JetBrains Mono), esquinas cuadradas (`--radius-*` en 2-4px).
   - Todo el sistema de color vive en los tokens semánticos de `:root` en `legacy.css` (`--bg`, `--ink`, `--brand`, `--danger`…) — cambiar la paleta es tocar ESE bloque, nunca colores sueltos por componente. Los iconos de `icons.ts` usan `stroke/fill="currentColor"`.
   - **La variedad de color vive en la navegación, no en el texto que se lee largo rato.** Cada entrada de `DRAWER_LINKS` (`BaseLayout.astro`) lleva su propio `accent`; al añadir una sección nueva, dale uno que no repita el de una vecina. `--danger`/`--warning` quedan reservados para alertas de verdad.
   - Jerarquía visual clara: estados de carga explícitos (`spinner`), alineación geométrica y márgenes proporcionales.
3. **La guía de Staff se sirve en el panel** (`/staff/docs`, `docs/guia-staff.md` leído por `GET /api/docs/staff`). Su renderizador (`apps/web/src/scripts/docs.ts`) solo entiende encabezados `#`..`###`, listas con `- `, citas con `> `, `---`, bloques de código, `**negrita**`, `` `código` `` y enlaces: nada de tablas, listas numeradas ni cursiva en ese fichero.

---

## ESTRUCTURA DEL REPOSITORIO
- **Bot de Discord**: `src/index.js`, comandos en `src/commands/player/` y `src/commands/staff/`, componentes y flujos en `src/components/`, eventos en `src/events/`.
- **Lógica**: `src/services/` (reglas, transacciones, auditoría) y `src/domain/` (funciones puras: `picarda.js`, `magic.js`, `civilStatus.js`).
- **Capa de datos**: `src/database/index.js` (contrato `query`/`execute`/`withTransaction`), `src/database/tables.js` (`T`), `src/database/migrations/mysql/` (esquema versionado).
- **API**: `src/apiServer.js` y `src/api/` (`routes/`, `middleware/`, `state/`, `utils/`). **Solo API, no sirve páginas.** Traefik le enruta únicamente `/auth`, `/api` y `/static`; todo lo demás va al Astro de `apps/web`. De `src/api/public/static` solo queda `default-avatar.svg`: no lo borres.
- **Panel web**: `apps/web/src/pages/` (vistas SSR), `apps/web/src/scripts/` (cliente), `apps/web/src/lib/` (`apiClient.ts`, `icons.ts`).
- **Catálogo opcional**: `scripts/seed-tomegrama.mjs` + `scripts/seed/`.
- **Ensayo de migración**: `scripts/rehearse-migration.mjs`.
- **Documentación**: `README.md`, `PLAYER_GUIDE.md`, `BACKUPS.md`, `docs/`.

---

## COMANDOS DE DESARROLLO
- Dev Frontend: `npm run dev --workspace=apps/web`
- Build Frontend: `npm run build --workspace=apps/web`
- Docker Local: `docker compose up -d --build`
- Logs de Servicio: `docker compose logs --tail=50 <servicio>` (servicios: `rpbot-bd`, `rp-disc-bot`, `rp-api`, `rp-web`, `nginx`)
- Tests:
  - `npm test` = `test:unit` + `test:commands` + `test:smoke` (el smoke arranca la API contra una MySQL y aplica las migraciones).
  - `npm run test:unit`: `node --test` sobre `test/*.test.mjs`, con la BD mockeada; no necesita MySQL.
  - `npm run test:commands`: carga todos los comandos y valida sus definiciones (`scripts/verify-command-defs.mjs`).
  - `npm run test:integration`: `test/integration/*.int.mjs` contra una MySQL real; borra los cuatro schemas al empezar. Se niega a correr contra los puertos 3306/3307 salvo `INTEGRATION_ALLOW_ANY_PORT=1`; por defecto usa 127.0.0.1:3399, usuario `root`, contraseña `testpw`.
  - `npm run rehearse-migration` (fixture) y `npm run rehearse-migration -- --current`: ensayo de las migraciones 035-041 sobre datos del juego antiguo.
- MySQL desechable para las pruebas, sin tocar la pila de producción del `docker-compose.yml` (su volumen apunta al RAID del servidor):
  `docker run -d --name rp-test-mysql -e MYSQL_ROOT_PASSWORD=testpw -p 3399:3306 mysql:8 --mysql-native-password=ON`
  y luego `DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw` delante del comando.
- `mock.module()` en los tests: SIEMPRE `defaultExport`/`namedExports`, NUNCA `exports`. Bajo el Node 22 del `Dockerfile`, `exports` no mockea nada en silencio y el import real revienta con "does not provide an export named '...'". En local (Node 26+) el fallo no se reproduce, así que esto solo se nota en el despliegue. Todo mock de `src/database/index.js` debe pasar además `namedExports: makeFakeNamedExports(esaMismaFakeDb)`, aunque el servicio bajo prueba no use hoy esos nombres: cualquiera de sus imports transitivos puede usarlos.
- Despliegue del rediseño: tras aplicar la migración 039 el rollback de imagen no sirve; solo restaurar el backup (ver `docs/deploy.md`).
