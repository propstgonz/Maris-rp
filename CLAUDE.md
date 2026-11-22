# ENGINEERING STANDARDS & ARCHITECTURE DIRECTIVES: rpdiscbot

Monorepo de alto rendimiento para Bot de Discord y Panel Web SSR de Administración de Roleplay.

---

## 🏎️ MODEL SELECTION & ROUTING (Gestión de Modelos)
- **Claude Haiku / Fast**: Inspección rápida de logs, búsquedas de contexto, verificación de tipos, formato y scripts simples de lectura.
- **Claude Sonnet**: Desarrollo diario, refactorización de lógica, integración de APIs, modificación de endpoints, componentes Astro y scripts de cliente Canvas.
- **Claude Opus**: Diseños arquitectónicos complejos, cambios estructurales multi-módulo, optimización de algoritmos de renderizado y resolución de bugs críticos de concurrencia/persistencia.

---

## 💻 ENTORNO DE EJECUCIÓN & HERRAMIENTAS (Windows / VS Code)
- **SO & Terminal**: Windows OS usando PowerShell (`PS C:\Windows\System32>`).
- **Formato de Archivos**: Formato estricto **LF** (`\n`). NUNCA guardar o convertir a CRLF (`\r\n`).
- **Prevención de Archivos Basura / Rutas Windows**:
  - Queda prohibida la creación de archivos o carpetas con prefijos como `;C` o rutas mal escapadas.
  - Al ejecutar comandos de terminal en PowerShell, asegura el uso correcto de comillas dobles y escapado de variables/rutas (`./path/to/file` o `"C:\path\..."`).
- **Docker Desktop**: Si la pila containerizada no responde, arranca Docker Desktop de forma autónoma antes de reintentar.
- **Despliegue Remoto**: Autorizado el uso de `.\ssh_server.bat` para operaciones en el servidor de producción.

---

## 🛡️ PROTOCOLO DE SEGURIDAD Y CONTROL DE DAÑOS
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

## 🏛️ PRINCIPIOS DE INGENIERÍA DE SOFTWARE (Anti-Vibecoding)
1. **Contratos de Interfaz e Invariantes**:
   - En `apps/web/` (TypeScript) todo módulo debe exportar tipos estrictos. `src/` es JavaScript plano y **sin JSDoc** — el contrato de un servicio lo fija su nombre, sus validaciones y su test, no un bloque de tipos que nadie comprueba y que envejece solo.
   - **MySQL (`mysql2/promise`) en cuatro schemas por dominio es la única fuente de verdad**: `rp_players`, `rp_world`, `rp_economy`, `rp_ops` (nombres cualificados centralizados en `src/database/tables.js`, módulo `T`). Las FK solo se declaran DENTRO de cada schema — las relaciones que cruzan schemas se garantizan en la capa de aplicación, nunca con una FK real.
   - Todo acceso a datos pasa por el contrato de `src/database/index.js`: `query()`, `queryOne()`, `execute()`, `withTransaction(fn)`. Las transacciones usan `AsyncLocalStorage` (no un parámetro de conexión pasado a mano) — `withTransaction()` deja la conexión activa en un contexto ambiente y `query`/`execute` la recogen solos si existe. Nunca reintroducir el patrón "pasar la conexión como argumento": es exactamente lo que este diseño existe para evitar.
   - `withTransaction()` es reentrante: si ya hay una transacción abierta se une a ella en vez de anidar otra. Por eso un servicio puede envolver a otro sin pensarlo — pero **nunca lances una promesa sin `await` dentro de un `withTransaction`**: hereda la conexión por el mismo `AsyncLocalStorage` y puede acabar usándola después del `commit` y de devolverla al pool. Si algo tiene que ser "dispara y olvida" (un `logAction`, un aviso), sácalo fuera del bloque.
   - **`execute()` devuelve `changes` = filas ENCONTRADAS, no filas cambiadas.** mysql2 conecta con `CLIENT_FOUND_ROWS`, así que un `UPDATE` que deja la fila igual sigue devolviendo 1. Consecuencia práctica: una condición de guarda tiene que ir en el `WHERE`, nunca en un `IF()` dentro del `SET` — con `IF()` la guarda parece funcionar y no funciona. Cualquier `changes === 0` que uses como "no se pudo" debe apoyarse en un `WHERE` que realmente no case.
   - Migraciones de esquema versionadas en `src/database/migrations/mysql/*.sql` (tabla `rp_ops.schema_migrations`, runner en `src/database/migrate.js`) — un fichero nuevo por cambio de esquema, nunca editar uno ya aplicado.
2. **Desacoplamiento Estructural**:
   - Prohibido acoplar lógica del bot de Discord dentro del frontend SSR o viceversa. Bot, mapServer y web SSR son **tres procesos que solo comparten MySQL** — ninguno puede llamar a una función del otro.
   - Dos canales SSE distintos, y no se mezclan: `/api/events` es Rolepriest-only (`requireAuth`) y difunde a todo el Staff; `/api/game/events` es por jugador (`requirePlayer`, `playerSseClients` en `state/sse.js`) y solo entrega a su destinatario. El mapa del mundo (`/mapamundi`) nunca debe suscribirse al canal de Staff: sus eventos llevan datos de otros jugadores.
   - **`rp_ops.audit_log` es el bus de coordinación entre plataformas, no solo el rastro de auditoría.** Toda acción de juego escribe una fila con `source` = de dónde vino la orden (`'web'` o `'discord'`), y dos consumidores simétricos la leen con el MISMO formateador puro (`src/services/activityFeed.js`): `activityEchoService.js` en el proceso del bot, `state/auditPoller.js` en el del mapServer. Cada consumidor omite al actor cuando la acción vino de su propia plataforma (allí ya se le contestó) y avisa siempre a los demás. Una acción nueva se cuenta añadiendo su entrada a `activityFeed.js`, nunca escribiendo el texto a mano en el sitio donde ocurre.
   - Cuando el mapServer necesita algo que exige el cliente de Discord (un MD, crear un canal, resolver combate real), no lo hace: encola un `bot_job` (`src/services/botJobService.js`) y el proceso del bot lo ejecuta. Nunca pasar `client = null` y esperar que el servicio se apañe.
3. **Manejo Riguroso de Errores & XSS**:  
   - Todo `innerHTML` debe pasar obligatoriamente por `escapeHtml()` (`apps/web/src/scripts/html.ts`).
   - Toda mutación cliente debe usar `apiFetch()` (`apps/web/src/scripts/api.ts`) asegurando la validación del token CSRF.
4. **Mantenibilidad y Limpieza**:
   - Prohibido dejar comentarios `TODO` sin resolver o código muerto comentado.
   - Aplica el principio DRY: extrae lógica repetida a utilidades puras y aisladas.
   - **Cero comentarios nuevos en el código, sin excepción** — ni QUÉ hace (ya lo dicen los nombres) ni POR QUÉ. Si una restricción oculta o un workaround necesita quedar explicado, va en el mensaje del commit, en este fichero o en la respuesta al usuario, nunca en el código. Al editar un fichero, aprovecha para quitar cualquier comentario que ya exista ahí, sea del tipo que sea (JSDoc incluido).
   - El repo está **a cero**: se purgaron 8.835 líneas de comentario de golpe, y una parte ya mentía (describían SQLite y una migración a MySQL "pendiente" que había ocurrido hacía meses). Sobreviven a propósito cuatro líneas, las únicas que evitan que alguien deshaga un arreglo creyendo que simplifica: por qué `claimCooldown` son dos sentencias, y que `CONSTRUCTION_ALIVE_SQL` exige el alias `c`. Ese es el listón para añadir uno nuevo — si el comentario no evita un bug concreto y reintroducible, no va.
   - Si hace falta purgar comentarios en masa otra vez: hazlo con el parser de TypeScript (`apps/web/node_modules/typescript`), localizando rangos por AST **y** por scanner, descartando los que caen dentro de literales (`https://…` en una plantilla se lee como comentario de línea), y verificando fichero a fichero que el flujo de tokens es idéntico antes y después. A ojo o con regex suelta se rompe código en silencio.

---

## 👑 MODERACIÓN Y PERMISOS
1. **Un solo rol de moderación: Rolepriest.**
   - `Staff` y `Rolepriest` eran dos nombres para el mismo rol de Discord — quedó unificado en `isRolepriest()`/`requireRolepriest()` (`src/utils/permissions.js`). `PERMISSION_LEVELS` es `['public', 'player', 'rolepriest']`. No reintroducir una distinción Staff/MapPriest: es moderación completa o no lo es.
   - En la sesión web, el campo es `isRolepriest` (no `isStaff`/`isMapPriest`) — ver `apps/web/src/middleware.ts` (`SessionUser`) y `src/mapServer/routes/auth.js`.
   - Rolepriest es autoridad **fuera de la ficción** — nunca concedible desde dentro del juego. No confundir con los permisos de facción de abajo.
2. **Permisos de facción — autoridad DENTRO de la ficción**, resueltos por `src/services/permissionService.js#resolvePermission(actor, scope, action)`, primer acierto gana: Rolepriest → dueño del objeto → cesión explícita vigente (`permission_grants`) → rango de facción (`faction_rank_permissions`) → política legacy por tipo (`checkConstructionPolicy()`, pura, en `src/utils/constructionPolicy.js`) → denegar.
   - `faction_ranks.rank_order` es **ASCENDENTE en autoridad** (Miembro=0 por defecto, Veterano=1, Colíder=2, Líder=3). Un permiso se guarda como "a partir de qué rango" (`required_rank_order`) — la comprobación es `rank_order >= required_rank_order`. Si algún día se invierte este orden, TODO el código que lo compara debe invertirse a la vez; no lo asumas al revés.
   - Catálogo cerrado de acciones en `src/utils/permissionActions.js` — cualquier acción nueva debe añadirse ahí Y quedar comprobada de verdad en algún sitio (hay un test que lo verifica).
   - Antiescalada: solo se puede ceder un permiso que (a) ya se posee y (b) va acompañado de `faction.rank_manage` o de la propiedad del objeto.
3. **Nomenclatura: `faccion`, no `nation`.** BD, servicios, rutas y web usan `faction`/`facción` en todo lo nuevo. Única excepción: `players.nationality` es el origen narrativo del personaje (texto libre de rol) — no tiene relación con el concepto de facción, no renombrar. El histórico de `audit_log` puede seguir teniendo filas con acciones `nation.*` de antes de la migración — por eso `ACTION_SECTION_MAP` (`src/mapServer/state/sse.js`) y `auditActions.ts` mantienen las claves `nation`/`nation.*` junto a las nuevas `faccion`/`faccion.*`, no las borres.

---

## 🎲 REGLAS DE JUGABILIDAD (invariantes, no estilo)

Cuatro reglas destiladas de una auditoría que encontró ocho fallos explotables. Cada una es un patrón que ya falló de verdad en este repo, no una precaución teórica.

1. **Un cooldown o un límite nunca se comprueba y luego se escribe.** Leer "¿puede?" y escribir "ya ha usado su turno" en dos pasos deja pasar dos peticiones simultáneas — y desde que la web y Discord son dos frentes sobre la misma partida, eso no es teórico. Se reclama en una sola sentencia atómica cuyo rechazo es `changes === 0`:
   - Cooldowns por (dueño, jugador) sobre una tabla con `last_used_at`: `claimCooldown()` de `src/services/cooldownService.js`. No escribas el SQL a mano otra vez.
   - Contadores y ventanas sobre `players` (el tope diario de ataques): un `UPDATE` condicional único, como `SQL.claimAttackSlot` en `combatService.js`.
   - **La reclamación va DENTRO de la misma transacción que el efecto que protege.** Si el efecto falla después (un inventario lleno), el cooldown tiene que deshacerse con él; si no, el jugador paga el turno y no recibe nada.
2. **Mover algo de un dueño a otro es una sola transacción.** "Quitárselo a A" y "dárselo a B" en dos pasos sueltos destruye el objeto en cuanto el segundo falla — y `addItem()` falla de verdad, por capacidad de peso, que es justo lo que pasa cuando alguien acaba de saquear. Vale para inventarios, almacenes, stock de NPC y botín. `tradeService._executeTrade` y `pickSurrenderLoot` son los dos ejemplos a copiar.
3. **Un ID que llega de fuera no prueba nada.** Todo comando o ruta que acepte el ID de un NPC, construcción o ítem tiene que comprobar por su cuenta **propiedad** (`owner_player_id` / `built_by_player_id` es quien lo pide) **y presencia** (el jugador está en esa casilla). Comprobar que dos cosas comparten dueño no es comprobar que ese dueño seas tú. La guarda decisiva va en el `WHERE` de la escritura además de en el `if`: es lo único que aguanta una carrera.
4. **Lo que cuesta jugar se cobra cuando la acción ocurre, no antes.** Munición, Laburo, cuota diaria y cooldown se reclaman después de todas las validaciones que pueden rechazar la acción, y en la misma transacción entre sí. Quedarte sin munición no puede gastarte el ataque del día.

---

## 🏭 PRODUCCIÓN Y ALMACENES (construcciones)
- El devengo de producción pasiva (`grants_resource_item_id`/`rate` de un tipo de construcción) es **perezoso + flush de respaldo**, nunca un cron que recorra todo el mapa: `src/services/productionService.js#settleConstructionProduction()` se llama tanto al interactuar con la construcción (mirar la casilla, usarla) como desde un cron cada 15 min para quien no está jugando — MISMA función en los dos sitios a propósito, no se puede reimplementar la lógica dos veces.
- El resultado va a `construction_storage` (almacén propio de esa instancia), nunca directo al inventario del dueño. Tope de `max_accrual_hours` (no acumula sin límite) y parada seca si el almacén está lleno (no cobra combustible, no avanza el reloj).
- Los generadores puramente manuales (`/map addgenerator`, sin construcción detrás) siguen en el reset diario de `cronService.js` — no los mezcles con lo de arriba.

---

## 🎨 DISEÑO E INTERFAZ PROFESIONAL (Enterprise UI/UX)
1. **Cero Emojis (No Emojis) — en el PANEL WEB**:
   - Queda estrictamente prohibido usar emojis en componentes, botones, avisos, logs o código visual **de la web (`apps/web/`)**.
   - Toda la iconografía debe implementarse mediante SVG vectoriales limpios usando la librería interna `icon()` (`apps/web/src/lib/icons.ts`).
   - **Excepción explícita: el bot de Discord (`src/`).** Discord no admite SVG ni CSS propio — el emoji ES su lenguaje de iconografía nativo (`setEmoji()` en botones, `emoji:` en opciones de desplegable, embeds). Prohibirlos ahí no daría una interfaz más sobria, daría una interfaz sin iconos. Se usan con la misma disciplina que los SVG en la web: uno por concepto, consistente entre flujos, nunca decorativos ni repetidos en la misma línea.
2. **Estética terminal (Fallout / Pip-Boy), no monocroma**:
   - Modo único, sin alternancia claro/oscuro: casi-negro de fondo, tipografía monoespaciada (`--sans`/`--mono` apuntan a JetBrains Mono), esquinas cuadradas (`--radius-*` en 2-4px).
   - Todo el sistema de color vive en los tokens semánticos de `:root` en `legacy.css` (`--bg`, `--ink`, `--brand`, `--danger`…) — cambiar la paleta es tocar ESE bloque, nunca colores sueltos por componente. Los iconos de `icons.ts` usan `stroke/fill="currentColor"`, así que heredan el color que les toque sin tocar un SVG.
   - **La variedad de color vive en la navegación, no en el texto que se lee largo rato.** `--ink` (cuerpo de texto) es un gris verdoso neutro a propósito — un verde fósforo saturado en TODO el texto cansa la vista en sesiones largas. Cada entrada de `DRAWER_LINKS` (`BaseLayout.astro`) lleva su propio `accent` (una custom property `--accent` puesta inline), que colorea solo el icono de esa sección (`.drawer-link svg` en `legacy.css`) — atenuado en reposo, a toda intensidad activo/hover. Al añadir una sección nueva, dale un `accent` propio que no repita el de una sección vecina en el menú.
   - `--danger`/`--warning` siguen reservados para alertas de verdad (rojo/ámbar) — ninguna sección del menú debe usarlos como su `accent`, para no leerse como una alerta falsa.
   - Jerarquía visual clara: estados de carga explícitos (`spinner`), alineación geométrica y márgenes proporcionales.
3. **Canvas de Alto Rendimiento**:
   - El renderizado en `mapCanvas.ts` debe preservar la separación entre coordenadas de mundo ($0..100$) y píxeles de pantalla.
   - Respeta el soporte para `devicePixelRatio` y la renderización en lotes mediante chunks (`CHUNK_SIZE = 20`).

---

## 🗺️ ESTRUCTURA DEL REPOSITORIO
- **Vistas SSR**: `apps/web/src/pages/`
- **Scripts de Cliente / DOM**: `apps/web/src/scripts/`
- **Renderizado Canvas**: `apps/web/src/scripts/mapCanvas.ts`
- **Cliente API Frontend**: `apps/web/src/lib/mapServerApi.ts`
- **Servidor Express / API**: `mapServer.js`, `routes/`, `services/` — **solo API, ya no sirve páginas.** El panel anterior a Astro (`public/app.html`, `public/static/app.js`…) se eliminó; Traefik enruta a este proceso únicamente `/auth`, `/api` y `/static`, y todo lo demás va al Astro de `apps/web`. De `public/static` solo queda `default-avatar.svg`, que el panel sí usa como avatar de reserva: no lo borres.
- **Bot de Discord**: `src/` (raíz)
- **Capa de datos**: `src/database/index.js` (contrato query/execute/withTransaction), `src/database/tables.js` (`T`, nombres cualificados), `src/database/migrations/mysql/` (esquema versionado)

---

## ⚙️ COMANDOS DE DESARROLLO
- Dev Frontend: `npm run dev --workspace=apps/web`
- Build Frontend: `npm run build --workspace=apps/web`
- Docker Local: `docker compose up -d --build`
- Logs de Servicio: `docker compose logs --tail=50 <servicio>`
- Tests: `npm test` (unit + comandos + GUI + mapa del mundo + smoke) — el GUI y el mapa del mundo necesitan una MySQL con esquema LIMPIO (solo migraciones, sin datos de una rehearsal), o los recuentos fijos de esos tests fallan por datos ajenos, no por un bug real.
- MySQL desechable para esas pruebas, sin tocar la pila de producción del `docker-compose.yml` (su volumen apunta al RAID del servidor):
  `docker run -d --name rp-test-mysql -e MYSQL_ROOT_PASSWORD=testpw -p 3399:3306 mysql:8 --mysql-native-password=ON`
  y luego `DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw` delante del comando. Entre el test de GUI y el del mapa hay que dejar el esquema limpio otra vez: `docker exec rp-test-mysql mysql -uroot -ptestpw -e "DROP DATABASE IF EXISTS rp_players; DROP DATABASE IF EXISTS rp_world; DROP DATABASE IF EXISTS rp_economy; DROP DATABASE IF EXISTS rp_ops;"`.
- `mock.module()` en los tests: SIEMPRE `defaultExport`/`namedExports`, NUNCA `exports`. Bajo el Node 22 del `Dockerfile`, `exports` no mockea nada en silencio y el import real revienta con "does not provide an export named '...'". En local (Node 26+) el fallo no se reproduce, así que esto solo se nota en el despliegue. Todo mock de `src/database/index.js` debe pasar además `namedExports: makeFakeNamedExports(esaMismaFakeDb)`, aunque el servicio bajo prueba no use hoy esos nombres: cualquiera de sus imports transitivos puede usarlos.
