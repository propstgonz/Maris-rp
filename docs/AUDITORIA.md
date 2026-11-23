# Auditoría final del rediseño (rama `rediseno-tomegrama`, commit `49a97b1`)

Auditoría independiente, hecha el 23-11-2026 sobre Windows 11 (Node 26.5 local) y Node 22.23 en Docker (`node:22-alpine`, la misma base del `Dockerfile`). Todo lo que se cita aquí lo he ejecutado o leído yo; no he dado por buenos los informes de otros agentes. No se ha tocado código, tests, migraciones ni producción.

## 1. Resumen ejecutivo

**Veredicto: APTO CON RESERVAS.**

El rediseño cumple los requisitos del usuario: el mapa ha desaparecido de los tres procesos y del esquema; `/perfil` enseña solo lo pedido; PICARDA, razas, menhires, matrimonio, los tres inventarios y la magia son fieles al PDF (los 75 conjuros, las 10 razas y los 11 menhires cuadran con el PDF); y las garantías importantes están en la base de datos o en sentencias atómicas. Todas las baterías de pruebas pasan, con una salvedad: un test inestable que depende del temporizador. El ensayo de migración termina en `ENSAYO SUPERADO`. El bot y la API arrancan.

No hay hallazgos críticos. Hay **dos importantes** que conviene corregir antes de desplegar, o al menos asumir de forma explícita:

1. **I-1 Una fila «en blanco» acepta escrituras.** Tras una muerte definitiva, la fila del jugador queda con `is_alive = 1` y `character_created_at = NULL`. Varios servicios solo comprueban `is_alive = 1`, así que una acción de un Rolepriest (o del propio jugador) que coincida con un `/kill` o con el cron de gracia se escribe en esa fila. El siguiente personaje la hereda: puntos extra, estadísticas, bienes, propiedades y nivel de magia. Lo he reproducido.
2. **I-2 El test `guardedInterval` es inestable.** Falla en 2 de 3 ejecuciones de la suite en Windows y en 1 de 5 en otra tanda. Es el fallo intermitente que se buscaba. En Linux con Node 22 (la configuración de CI) pasó 3 de 3.

## 2. Resultados de los comandos ejecutados

| Comando | Resultado |
|---|---|
| `npm ci` (raíz) | OK, 306 paquetes. Avisa de 4 vulnerabilidades moderadas |
| `npm ci` (`apps/web`) | OK, 0 vulnerabilidades |
| `npm run test:unit`, ejecución 1 | **281/281** OK (1,28 s) |
| `npm run test:unit`, ejecución 2 | **280/281**: falla `startGuardedInterval: una tarea SÍNCRONA (sin promesa) también respeta la guarda` («llamadas: 1») |
| `npm run test:unit`, ejecución 3 | **280/281**: el mismo test |
| `npm run test:unit`, 5 ejecuciones más | 1 de 5 con fallo |
| `node --test test/guardedInterval.test.mjs` solo, 10 veces | 0 de 10 con fallo (solo falla con la suite en paralelo) |
| `test:unit` en Node 22 / Linux (Docker), 3 veces | **281/281** las tres |
| `npm run test:commands` | 22 comandos (11 de jugador, 11 de staff), «Definiciones válidas — 0 problemas» |
| `node scripts/ci-smoke-test.mjs` (MySQL 3440) | **9 pasaron, 0 fallaron** |
| `npm run test:integration`, ejecución 1 | **94/94** |
| `npm run test:integration`, ejecución 2 | **94/94** |
| `test:integration` en Node 22 / Linux | **94/94** |
| `rehearse-migration.mjs` (modo fixture) | 26 comprobaciones `[OK]`, **ENSAYO SUPERADO**: 41/41 migraciones; conjuros 21/15/11/14/14; 10 razas; 11 menhires; 6 escuelas, 5 de ellas activas |
| `npm run seed:tomegrama`, 1.ª vez | 11 categorías, 65 bienes y 34 tipos de propiedad nuevos |
| `npm run seed:tomegrama`, 2.ª vez | 0 / 0 / 0, idempotente |
| `apps/web`: `npm run build` | OK («Complete!») |
| `apps/web`: `npx astro check` | 31 ficheros, **0 errores, 0 avisos, 0 sugerencias** |
| `npm audit --omit=dev` (raíz) | **4 moderadas**: `qs` (vía `express`, se arregla con `npm audit fix`) y `uuid` (vía `node-cron` 3; el arreglo exige actualizar a `node-cron` 4, con cambios incompatibles) |
| `npm audit --omit=dev` (`apps/web`) | 0 vulnerabilidades |
| Arranque del bot sin Discord (loaders reales y `discord.js` real) | 22 comandos y 5 eventos cargados; 22 definiciones `toJSON()` válidas (18 979 bytes); BD lista; `client.login` con token falso rechazado con `TokenInvalid`, que es lo esperado |
| `node src/apiServer.js` real (puerto 3471) | Escucha y migra. `GET /api/me` da **401**; `POST /api/terminal/sql` sin CSRF da **403**; `/auth/login` da 302 hacia Discord con `state` |

Esquema final de la MySQL migrada: `rp_world` = {`properties`, `property_types`}; `rp_economy` = {`inventory`, `item_categories`, `items`}. Ninguna columna se llama `tile`, `coord`, `terrain`, `zone`, `faction`, `laburo`, `hp` ni `hunger`. `player_npcs` = {`id`, `owner_player_id`, `name`, `created_by_discord_id`, `created_at`}.

## 3. Criterios de aceptación

| # | Criterio | ¿Cumple? | Evidencia |
|---|---|---|---|
| 1 | No queda nada del mapa | **Parcial** (solo restos de despliegue) | El código está limpio: `grep` amplio en `src`, `apps/web/src`, `scripts` y `test`, y lo único que aparece son el ensayo de migración, `cleanup-zombies.sh` (que borra ficheros viejos) y los smoke tests que exigen 404. Sin `pngjs` en ningún `package.json`. Las migraciones 039, 040 y 041 borran tablas y columnas, y lo he comprobado en la BD. Quedan restos: los montajes `/app/items`, `/app/constructions` y `/app/npcs` (`docker-compose.yml:43,70-72`, `Jenkinsfile:114-118`) y `config.json:17,22-24` (ver M-4) |
| 2 | `/perfil` solo muestra cabecera, estadísticas, raza, menhir y estado civil | Sí | `src/utils/embeds.js:87-121`: título con nombre, género, edad, «Creado», miniatura del avatar, y 4 campos (Estadísticas, Raza, Menhir, Estado civil). La Magia va en `/escuelas` |
| 3 | PICARDA: máximo 6 por estadística, 8 + bono en total, irreversible, bonos de raza y menhir | Sí | `CHECK (stat_* BETWEEN 0 AND 6)` (035). La guarda de suma está en el `WHERE` (`profileService.js:30-36`). El jugador solo puede sumar; `correctStat` es exclusivo de Rolepriest. `effectiveStats` no limita la estadística efectiva (aviso de la pág. 39). Las 10 razas y los 11 menhires coinciden con las págs. 37-39 y 56-57 |
| 4 | Matrimonio: solo entre vivos, con aceptación, nunca dos vigentes, coherente y con viudedad | Sí | `UNIQUE (player_id, open_slot)` (035) con un solo registro `marriages`. `acceptMarriageInTx` bloquea a los dos jugadores vivos. Viudedad con `ended_by_player_id` = el fallecido; `lastEnded` filtra por `character_created_at` (`marriageService.js:301-309`). Pruebas: `marriage.int.mjs` y `lifecycle.int.mjs` |
| 5 | Tres inventarios independientes con traspasos atómicos aceptados | Sí | `player_npcs`, `inventory` y `properties`. `consentService.accept` hace la reclamación y el `dispatch` en una sola transacción con el dueño en el `WHERE` (`goodsService._takeInTx`, `npcHoldingService.transfer` con `changes !== n`, `propertyService.transfer`) |
| 6 | NPCs sin columnas de estadísticas | Sí | `SHOW CREATE TABLE player_npcs` (ver arriba) |
| 7 | 5 escuelas activas y Encantamiento inactiva; umbrales, mentor y enfriamiento del PDF; tirada atómica | Sí | 036: Encantamiento con `is_active = 0`. Umbrales 19/19/20,5/24/28; `requires_mentor = 1` en todos los niveles; `RETRY_DAYS = 28`. `claimRoll` es un único `UPDATE` con `retry_after` en el `WHERE`, en la misma transacción que la promoción. Modificadores de la pág. 42 (`attemptModifier`) |
| 8 | Conjuros visibles = `min_rank <= nivel` en escuelas activas; catálogo literal | Sí | `magicService.js:76-80,316-320`. **Comparé los 75 conjuros** (nombre, nivel, coste y recurso) con las págs. 44-50 del PDF y coinciden todos. En Destrucción la descripción parafrasea el texto que el PDF da por grupo |
| 9 | Se conservan modmail, periódico, broadcast, `/dado`, auditoría, backups, terminal, kill/revive y panel de staff | Sí | Comandos `/modmail-*`, `/periodico`, `/broadcast`, `/dado`, `/kill` y `/revive`; `messageCreate`; rutas `auditLog`, `backups`, `terminal`, `broadcast`, `players` y `docsStaff`; páginas Astro del staff. Las páginas web de jugador del sistema antiguo (`/personaje`, `/guia`) se quitaron sin ADR (ver M-7) |
| 10 | Tests y build en verde; bot y API arrancan | **Parcial** | Todo en verde salvo el test inestable I-2. El arranque está verificado (§2) |
| 11 | Entregables completos y coherentes | **Parcial** | Existen README, ARQUITECTURA, ADR (47 entradas), COMANDOS, TRAZABILIDAD, guía de staff, `PLAYER_GUIDE.md`, `BACKUPS.md`, `deploy.md` (con runbook) y `migration.md`. Contrasté 18 afirmaciones; 15 son exactas y 3 no (ver §3.1) |
| 12 | Nada de `git push` y ningún secreto | Sí | `rediseno-tomegrama` no tiene rama remota (`git branch -r` solo muestra `origin/main`, con 1 commit). `git log origin/main..HEAD` devuelve 52 commits locales. Ni `.env` ni tokens versionados; `config.json` solo contiene IDs de Discord, que no son secretos |

### 3.1 Afirmaciones de la documentación contrastadas con el código

Exactas: ADR-11 (UNIQUE en la 035); ADR-16 (umbral 20,5); ADR-17 (`requires_mentor = 1`); ADR-19 (28 días); ADR-21 (`magicPoints`); ADR-28 (la purga respeta `personaje.muerte`, `auditLogService.js:20`); ADR-33 (21/15/11/14/14); ADR-36 (`requireOtherTarget`/`rejectSelfTarget` en los 5 comandos admin, `/kill`, `/revive` y `/periodico abrir`); ADR-37 (`setMenhir` conserva `menhir_chosen_at`); ADR-38 (tope de 5, `consentService.js:142-145`); ADR-40 (`GET_LOCK` de 600 s y `RELEASE_LOCK` en `finally`); ADR-41 (`/dado`); ADR-45 (revalidación cada 10 min y destrucción de la sesión); «los comandos no escriben SQL» (ningún `src/commands/**` importa la BD); README («5 servicios», documentos enlazados existentes).

Inexactas:
- `docs/COMANDOS.md:30`: dice que `/perfil` muestra «Magia» y «botones para pasar a NPCs…». En realidad no muestra la Magia y la navegación es un menú desplegable.
- `docs/COMANDOS.md:83`: `usuario` figura como «obligatoria» y, a la vez, «sin esta opción el bot lo pregunta con un selector»; con `setRequired(true)` (`matrimonio.js:11`) el selector nunca aparece desde el comando.
- ADR-46: «rechaza lecturas con bloqueo», pero `FOR SHARE` pasa (ver M-3). ADR-28 y la descripción de `/revive personaje_id` (`revive.js:41`) dicen «dentro de la ventana de 7 días», pero el código no lo comprueba (ver M-1).

## 4. Hallazgos abiertos

### Críticos

Ninguno.

### Importantes

**I-1. Los servicios escriben en la fila «en blanco» de un personaje con muerte definitiva, y el siguiente personaje lo hereda.**
- Dónde: `characterLifecycleService.js:153-166` (`resetToBlank` deja `is_alive = 1`, por diseño, y `lifecycle.int.mjs:100` lo afirma) y `:43-54` (`claimCreation` no reinicia `stat_*`, `stat_bonus_points`, `menhir_*` ni `free_school_claimed_at`). Las guardas que solo miran `is_alive = 1`: `profileService.js:33,41,48,50,54,61,66`, `goodsService.js:26`, `propertyService.js:45` y `magicService.js:26,37,47,66`. En cambio `npcHoldingService.js:14` y `marriageService.js:14` ya comprueban `character_created_at IS NOT NULL`: el criterio no es el mismo en todos los servicios.
- Reproducción, con un test temporal contra MySQL real que ya he borrado: tras `killCharacter`, aceptan la fila en blanco `grantBonusPoints(50)`, `allocateStat('autismo', 6)`, `addGoods(100)`, `grantProperty` y `magic.setLevel('destruccion', 5)`. Después de `createCharacter`, el personaje nuevo nace con Autismo base 6, 50 puntos extra, 1 bien, 1 propiedad y Maestro en Destrucción.
- Cómo se llega: los comandos validan el objetivo al principio (`requireTargetCharacter`), pero el servicio vuelve a escribir sin esa guarda. La ventana es corta en `/bienes-admin dar`, `/perfil-admin puntos-extra` y `/magia-admin fijar` (subir), y de hasta 60 s en los flujos con confirmación: «Asignar puntos» del jugador, `/perfil-admin corregir-stat`, `/perfil-admin raza` y `/magia-admin fijar` (bajar). Basta con que en ese hueco otro Rolepriest haga `/kill` o con que el cron de las 00:30 cierre una gracia. Esto contradice la regla 4 del Reglamento («sin lucro post mortem») y la regla de CLAUDE.md: la guarda decisiva tiene que ir en el `WHERE`.
- Corrección propuesta: añadir `AND character_created_at IS NOT NULL` en todas esas guardas, igual que hacen ya `npcHoldingService` y `marriageService`. Como defensa adicional, que `claimCreation` deje a cero las columnas de perfil y magia, o que `createCharacter` rechace la creación si quedan filas en los inventarios. Añadir un test de integración: «tras /kill, ninguna escritura de servicio afecta a la fila en blanco».

**I-2. Test inestable: `test/guardedInterval.test.mjs:47-56`.**
- Escenario: espera 35 ms con un intervalo de 10 ms y exige 2 o más llamadas. En Windows, la resolución del temporizador es de unos 15,6 ms y además corre en paralelo con los demás ficheros de test, así que a veces solo hay 1 tick. Resultado: 2 fallos en 3 ejecuciones de la suite, 1 en 5 en otra tanda, 0 en 10 aislado y 0 en 3 en Linux con Node 22. Los otros dos tests del mismo fichero tienen el mismo patrón, aunque con más margen.
- Corrección propuesta: usar `mock.timers.enable({ apis: ['setInterval'] })` y `mock.timers.tick(...)` para hacerlo determinista, o al menos esperar 10 o más intervalos. No es un fallo del producto, pero en CI (`npm test` en el stage Test) puede tumbar un despliegue sin motivo.

### Menores

- **M-1. `/revive` revive aunque ya hayan pasado los 7 días de gracia, mientras no haya corrido el cron.** `characterLifecycleService.js:86-90` (`claimRevive` no lleva límite de tiempo, a diferencia de `claimReturn`, `:92-97`). Lo he reproducido: con `died_at` de hace 9 días, la revivió. La documentación (`revive.js:41`, `COMANDOS.md`, ADR-28) dice «dentro de la ventana de gracia». Corrección: añadir `AND died_at > NOW() - INTERVAL 7 DAY` o documentar la excepción. Relacionado: un personaje revivido a mano cuando su jugador ya no está en el servidor queda vivo para siempre, y desde los MD puede aceptar traspasos.
- **M-2. `authorizedRoll` sin `retryOnDeadlock` y sin bloquear `players` primero.** `magicService.js:215-265`: `claimRoll` (`:44-51`) hace JOIN con `players` después de bloquear `school_progress`, en contra del orden de ADR-39. Si coincide con `/kill` del mismo jugador puede haber un deadlock, que acaba en el mensaje genérico «Ocurrió un error». Es raro y no pierde datos (la transacción se deshace). Corrección: `lockPlayersInTx([playerId])` al principio y `{ retryOnDeadlock: 3 }`.
- **M-3. Terminal SQL: `SELECT … FOR SHARE`, `performance_schema` y `sys` no se bloquean.** `src/api/utils/sqlGuard.js:9-11`. Con autocommit no retiene bloqueos y es solo para Rolepriest, pero no cumple ADR-46. `performance_schema.events_statements_history` deja ver SQL de otras sesiones. Corrección: añadir `\bfor\s+share\b` y los schemas `performance_schema` y `sys` a la lista negra, o mejor, usar una cuenta MySQL de solo lectura para el terminal.
- **M-4. Restos de despliegue del mundo antiguo.** Montajes `/app/items`, `/app/constructions` y `/app/npcs` (`docker-compose.yml:43,70-72`); el preflight de Jenkins crea esas carpetas (`Jenkinsfile:114-118`); `config.json:17` (`channels.transactions`) y `:22-24` (`itemsHostPath`, `constructionsHostPath`, `npcsHostPath`) no los lee nadie. Corrección: borrarlos (el README, §`config.json`, también los menciona).
- **M-5. Los comandos de staff con confirmación fallan desde el terminal web con un error críptico.** `confirm.js:6-10` llama a `interaction.fetchReply()`, que la interacción sintética no tiene (`terminalJobService.js:123-157`). Resultado: `/bienes-admin quitar`, `/npcs-admin baja`, `/propiedades-admin revocar`, `/perfil-admin raza|corregir-stat|anular-matrimonio`, `/magia-admin fijar` (bajar) y los `catalogo` paginados devuelven «interaction.fetchReply is not a function». No ejecutan nada, así que es seguro, pero confunde. Corrección: un mensaje claro de «este subcomando pide confirmación; úsalo desde Discord», o filtrarlos en `processNextJob`.
- **M-6. Desajustes de documentación** (§3.1): `COMANDOS.md:30` y `:83`, ADR-46, ADR-28 y `/revive personaje_id`.
- **M-7. Funcionalidad antigua retirada sin ADR.** La web antigua tenía páginas de jugador `/personaje` (ficha) y `/guia` (guía de roleo); ver `git show a18d551:apps/web/src/pages/guia/index.astro`. Ahora la web es solo de staff. Es coherente con ADR-02 (la ficha ahora es `/perfil`), pero la guía de roleo era contenido de comunidad. Corrección: confirmarlo con el usuario y registrarlo en ADR-02.
- **M-8. El Rolepriest puede nombrarse mentor a sí mismo.** `magia-admin.js:14-21` solo impide que el objetivo sea él, no el mentor. Si se aplica el Reglamento al Lorepriest, regla 2 («no se auto-rolea»), debería requerir a otro Rolepriest. Corrección: `rejectSelfTarget(interaction, mentor.id)`.
- **M-9. Dependencias.** `qs` vía `express` (moderada, la API es pública): `npm audit fix` lo resuelve sin cambios incompatibles. `uuid` vía `node-cron@3`: no aplica (solo afecta a v3/v5/v6 con `buf`); se puede dejar anotado.
- **M-10. Las migraciones no se pueden volver a ejecutar si fallan a medias.** `migrate.js:84-91` aplica las sentencias una a una, sin transacción (los DDL de MySQL hacen commit implícito). Si la 037 falla tras el `INSERT … ON DUPLICATE KEY UPDATE` de inventario, al reintentarla se sumarían los bienes dos veces. El runbook ya exige un volcado previo y un ensayo `--current`; esto solo refuerza por qué no se pueden saltar.

## 5. Riesgos de despliegue y pasos previos obligatorios

1. **Backup manual previo** (`deploy.md`, «Despliegue del rediseño», paso 1) y copia fuera del servidor. Desde la 039 no se puede volver con la imagen anterior: solo restaurando.
2. **Ensayo `--current` con una copia real de producción** en una MySQL desechable, hasta que termine en `ENSAYO SUPERADO`. El ensayo con datos de prueba sale bien, pero los datos reales pueden traer valores que no caben en `DECIMAL(14,2)` (unos 10¹² o más), o tipos sin categoría. Revisar las cifras de «descartado» (suelo del mapa y construcciones sin dueño) y los truncados (por ejemplo, 0,004 se queda en 0 y se borra; es lo documentado en ADR-32).
3. **Corregir I-1 antes de abrir el bot** o, si se despliega igual, avisar a los Rolepriest: no tocar a un jugador mientras se le aplica `/kill`, y no dejar confirmaciones abiertas sobre alguien a punto de morir.
4. **Estabilizar I-2** o reintentar el job de Jenkins si falla por ese test. En Linux no se ha reproducido.
5. **Actualizar `.env` y `config.json`** del servidor: `MAP_SERVER_*` pasa a `API_*`, y los roles que estaban en `mapPriest` pasan a `staff`. Sin esto la API no arranca o un moderador pierde permisos.
6. **`npm audit fix`** en la raíz (actualiza `qs`/`express`) y repetir los tests.
7. Tras el despliegue: `/api/me` → 401, `/staff` carga, un `/perfil` real, un `/solicitudes`, y comprobar que el cron de las 00:30 UTC y el backup corren (logs).

## 6. Resolución tras la auditoría

Corregido por el orquestador después de este informe. Las pruebas se volvieron a ejecutar tras los cambios.

| Hallazgo | Estado | Corrección |
|---|---|---|
| I-1 Escrituras sobre la fila de un personaje muerto | Resuelto | Las guardas de perfil, bienes, propiedades y magia exigen `character_created_at IS NOT NULL`. `createCharacter` vacía inventarios, progreso mágico y estadísticas en la misma transacción antes de reclamar la fila (ADR-50). Test de regresión en `test/integration/lifecycle.int.mjs`. |
| I-2 Test inestable de `guardedInterval` | Resuelto | El test de la tarea síncrona usa `mock.timers`. La suite unitaria pasó 5 de 5 veces seguidas. |
| M-1 `/revive` tras vencer la gracia | Resuelto | `claimRevive` exige `died_at` dentro de los 7 días de gracia. |
| M-2 `authorizedRoll` sin reintento ni bloqueo previo | Resuelto | Bloquea la fila del jugador al empezar y usa `retryOnDeadlock: 3`. |
| M-3 Terminal SQL con `FOR SHARE` y schemas de sistema | Resuelto | `sqlGuard` rechaza `FOR SHARE`, `performance_schema`, `sys` e `information_schema`. |
| M-4 Restos de despliegue del mapa | Resuelto | Fuera los montajes de objetos, construcciones y NPCs en `docker-compose.yml` y en el sondeo del `Jenkinsfile`. `config.json` solo conserva las claves que se leen (ADR-49). |
| M-5 Comandos con confirmación desde el terminal web | Resuelto | La interacción sintética explica que esos subcomandos se usan desde Discord. |
| M-6 `COMANDOS.md` | Resuelto | `/perfil` descrito como es (menú desplegable, sin Magia) y la opción `usuario` de `/matrimonio proponer` es obligatoria. |
| M-7 Páginas web de jugador retiradas sin ADR | Resuelto | ADR-48. |
| M-8 Rolepriest como mentor de su propia tirada | Resuelto | `/magia-admin tirada` lo rechaza (ADR-50). |
| M-9 `npm audit fix` en la raíz | Resuelto | Quedan 2 avisos moderados de `uuid` vía `node-cron` 3. Solo se arreglan con un cambio mayor (`--force`) y no afectan, porque el bot no pasa `buf` a `uuid`. |
| M-10 Migraciones no repetibles si fallan a medias | Mitigado | El runbook de `docs/deploy.md` exige backup y ensayo `--current` antes; el `Jenkinsfile` hace un `mysqldump` previo al despliegue. |

**Resultados tras las correcciones**

| Prueba | Resultado |
|---|---|
| `test:unit` | 282/282, 5 de 5 ejecuciones |
| `test:commands` | 0 problemas |
| `test:integration` | 95/95 |
| Smoke | 9/9 |
| Ensayo de migración | Superado |
| Build web | Correcto |

**Veredicto tras las correcciones:** sin hallazgos críticos ni importantes abiertos. Antes de desplegar sigue siendo obligatorio el runbook de la sección 5: backup, ensayo sobre una copia de producción, `.env` con las variables `API_*` y `config.json` revisado.
