# Registro de decisiones (ADR)

Cada entrada: contexto → decisión → consecuencia. Las marcadas **[usuario]** las tomó el dueño del proyecto; el resto son interpretaciones del Tomegrama revisables.

## Alcance

**ADR-01 [usuario] — Se elimina el mapa de los tres procesos.** Bot, API y web. Sin casillas, viajes, terreno, zonas, POIs, temperatura ni encuentros.

**ADR-02 [usuario] — Del bot antiguo solo se conserva comunidad y staff.** Modmail, periódico/imprenta, broadcast, `/dado`, auditoría, backups, terminal, kill/revive y panel de staff. Se eliminan facciones, Laburo, vida/hambre, consumibles, crafteo, comercio, saqueo, robo, mercado, producción, combate y NPCs con estadísticas. Motivo: casi nada de eso está en el Tomegrama y todo dependía del mapa.

**ADR-03 [usuario] — Solo los jugadores poseen cosas.** NPCs, bienes y propiedades pertenecen a un perfil de jugador.

**ADR-04 [usuario] — Altas y bajas las hace un Rolepriest; los jugadores traspasan con aceptación.** El Tomegrama resuelve las adquisiciones con dados y arbitraje del Lorepriest, así que el bot registra el resultado. Los traspasos entre jugadores necesitan que el destinatario acepte y son atómicos.

**ADR-05 [usuario] — Privacidad.** Cada jugador ve solo lo suyo, en respuestas efímeras. El Rolepriest puede consultar a cualquiera. Evita el meta-rol (Reglamento al Usuario, regla 3).

## Perfil

**ADR-06 [usuario] — Identidad.** Se conservan nombre, avatar y género; se añade la edad; se muestra la fecha de creación. Se eliminan `full_name` (duplicaba `character_name`), `nationality`, `origin_country`, `religion` y `description`, tras backup.

**ADR-07 — PICARDA (págs. 17-18).** 8 puntos base, máximo 6 por estadística, irreversibles para el jugador. Se pueden dejar puntos sin gastar. Los puntos extra solo los concede un Rolepriest (`stat_bonus_points`). El Rolepriest puede corregir errores; queda auditado.

**ADR-08 — Raza (págs. 37-39).** Se elige al crear el personaje; el jugador no la cambia; el Rolepriest puede corregirla. Los modificadores se suman a la base al calcular la estadística efectiva, que puede pasar de 6 o quedar negativa (aviso de la pág. 39).

**ADR-09 — Menhires (Tomegrama págs. 56-57, versión actualizada).** 11 menhires en catálogo cerrado con sus efectos literales. Los +1 a una estadística se suman a la estadística efectiva (como la raza); el Menhir del Mago suma +50 a la Magia; el Menhir Ritual convierte toda la Magia en Vida (Magia/100). Atronach, Amante, Ofidio (inmunidad a Ilusiones), Sombrío: efectos narrativos, solo texto. **Elige el jugador** («El Usuario solo puede elegir 1 Menhir») y debe esperar 6 meses reales para cambiarlo (`menhir_chosen_at`). El Rolepriest puede corregirlo. Sustituye a la decisión provisional «solo Rolepriest asigna», tomada cuando el Tomegrama aún no definía los menhires.

**ADR-10 [usuario] — Estado civil = matrimonio.** El Tomegrama no define estados civiles. Soltero/a por defecto; Casado/a con otro jugador registrado y vivo, por solicitud y aceptación; monógamo; divorcio por cualquiera de las partes; Viudo/a si muere el cónyuge; el Rolepriest puede anular.

**ADR-11 — Integridad del matrimonio en la BD.** Un solo registro `marriages` compartido por ambas partes y `UNIQUE(player_id, open_slot)` en `marriage_members`. Es imposible tener dos matrimonios vigentes o que un perfil muestre la relación y el otro no.

## Magia

**ADR-12 [usuario] — Cinco escuelas activas; Encantamiento inactiva.** El PDF habla de seis y excluye Encantamiento «hasta nuevo aviso» (pág. 51). Queda en el catálogo con `is_active = 0` y sin conjuros.

**ADR-13 [usuario] — Las tiradas usan la estadística efectiva (base + raza + menhir).**

**ADR-14 [usuario] — Escuela gratuita con Autismo efectivo (base + raza + menhir) ≥ 6.** Una sola vez por personaje (`free_school_claimed_at`).

**ADR-15 [usuario] — Tiradas de dominio: el Rolepriest autoriza, el bot tira.** El Rolepriest valida al mentor (puede ser NPC). Si el mentor es un jugador, el bot comprueba su nivel. Reclamación, tirada, resultado y enfriamiento van en una transacción.

**ADR-16 — Umbrales (pág. 43).** Principiante ≥19; Aprendiz ≥19; Hábil «mayor a 20» ⇒ umbral 20,5; Experto ≥24; Maestro ≥28. Destrucción suma Autismo/2, así que sus totales acaban en ,5 y un total de 20,5 es «mayor a 20»; con un umbral de 21 (la primera versión) se rechazaba un 20,5 legítimo. El resto de escuelas dan totales enteros y 20,5 equivale a exigir 21. Migración `036` (`mastery_levels.threshold = 20.5`); `thresholdLabel` lo muestra como «más de 20».

**ADR-17 — Mentor.** Los cinco niveles exigen mentor (pág. 41), incluido el Principiante: `mastery_levels.requires_mentor = 1` para todos. Con mentor jugador el bot comprueba que su nivel en esa escuela es ≥ el nivel objetivo; con un NPC mentor el Rolepriest da su palabra (`mentor_npc`, se guarda en `mentor_label`). Para Maestro el PDF pide «igual nivel», que coincide porque Maestro es el máximo. Nadie puede ser su propio mentor.

**ADR-18 — Destrucción suma Autismo/2 sin redondear.** El umbral se compara con el decimal.

**ADR-19 — Enfriamiento de 4 semanas = 28 días reales, por (jugador, escuela).** El tiempo «semana» del Tomegrama en mecánicas es tiempo off-rol (Reclutamiento: «por semana (o en 7 días por defecto)»).

**ADR-20 — Los conjuros desbloqueados se calculan, no se guardan.** El nivel de dominio implica el acceso; una tabla de desbloqueos podría desincronizarse. Calcularlo hace imposible un desbloqueo ilegítimo y mantiene la coherencia si el nivel cambia.

**ADR-21 — Magia = min(25 × Autismo efectivo, tope) + bono del Menhir del Mago.** Pág. 41 y 56. El tope es literal: 150 + 25 × el bono racial de Autismo (`races.mod_autismo`), es decir 150/175/200. El Menhir del Aprendiz (+1 Autismo) sube la Autismo efectiva y por tanto la tirada, pero no el tope, que solo depende de la raza. El Menhir del Mago suma +50 aparte del tope. Con el Menhir Ritual toda la Magia pasa a Vida (Magia/100). Implementado en `domain/picarda.js#magicPoints(effective, menhirRow, raceRow)`.

## Inventarios

**ADR-22 — Tres inventarios en tablas distintas.** `player_npcs`, `rp_economy.inventory` y `rp_world.properties`. Comparten solo el mecanismo de solicitud (`consent_requests`).

**ADR-23 — NPCs sin estadísticas.** Una fila = un NPC con nombre. Unidades de población, rangos militares y oficios se expresan en el nombre si hace falta.

**ADR-24 — Cantidades decimales.** El Tomegrama usa 0,5 (hierro fundido, toneladas de comida). `DECIMAL(14,2)`.

**ADR-25 — Clasificación.** Barcos, galeras y buques son propiedades (categoría naval; se pueden arrendar). El ganado es un bien (categoría Ganado). Platas es un bien de la categoría Moneda.

**ADR-26 — Límites por ciudad no se hacen cumplir.** `location` es texto libre informativo.

**ADR-27 — Catálogo inicial opcional.** `npm run seed:tomegrama` inserta (por nombre, idempotente) los bienes y edificios que nombra el PDF. No se ejecuta solo para no duplicar el catálogo de producción.

## Ciclo de vida

**ADR-28 [usuario] — Dos muertes: en gracia y definitiva.** Al salir del servidor el personaje entra en gracia durante 7 días (`personaje.gracia`, `is_alive = 0`): no se vacía nada, y `/revive` o volver al servidor (`guildMemberAdd`, solo si `died_at` tiene menos de 7 días) lo devuelve intacto. La muerte definitiva llega con `/kill` o cuando se acaba la gracia (cron 00:30 UTC): en una transacción se vacían los tres inventarios, las estadísticas, la raza, el menhir, los puntos extra, la escuela gratuita y el progreso mágico, se cancelan las solicitudes pendientes y el matrimonio acaba en viudedad. La instantánea previa se guarda en `audit_log` (`personaje.muerte`, que la purga de 30 días no borra). Si hay herencia narrativa, el Rolepriest la traspasa antes del kill. Motivo: Reglamento regla 4 (sin lucro post mortem). `/kill` sobre un personaje en gracia lo finaliza al instante.

**ADR-29 — 336 h de espera desde la muerte.** Mecánica RED regla 1. El valor por defecto de `character_creation_cooldown_hours` es 336 y se cuenta desde `died_at`, que se fija al entrar en gracia y no se mueve al pasar a definitiva. Quien ya esperó la gracia entera tiene la espera casi cumplida: el cooldown no se reinicia al vencer los 7 días. El Rolepriest lo cambia con `/perfil-admin cooldown-creacion` (0 = sin espera).

## Técnica

**ADR-30 — `migrate.js` deduce el esquema del nombre del fichero.** Elimina el mapa manual `FILE_SCHEMA`, que hacía fallar el arranque si alguien olvidaba registrar una migración.

**ADR-31 — Renombrado mapServer → API.** `src/mapServer.js` → `src/apiServer.js`, `src/mapServer/` → `src/api/`, servicio `rp-map-editor` → `rp-api`, variables `MAP_SERVER_*` → `API_*`. El host DNS público no cambia.

**ADR-32 — Migración de datos sin pérdida de bienes con dueño.** Migración `037`: NPCs con dueño → `player_npcs`; construcciones → `properties`; y al inventario del dueño se suman las existencias de almacenes de construcciones, almacenes e inventarios de NPCs, almacenes de facciones, herramientas equipadas a NPCs (1 unidad cada una), stock de los mercados de construcciones y combustible depositado en construcciones. Las cantidades se truncan a 2 decimales (`038`, `DECIMAL(14,2)`; no se redondea hacia arriba) y se borran las filas que quedan en 0. Se pierde lo que no tiene dueño: los objetos del suelo del mapa (`tile_items`), las construcciones sin constructor válido y todo lo que depende de un dueño inexistente. `npm run rehearse-migration` cuadra las cifras por fuente antes de desplegar (ADR-43).

**ADR-33 — Conjuros: 75 en total.** Recontado contra el PDF: Destrucción 21, Alteración 15, Restauración 11, Ilusión 14, Conjuración 14. Las cifras 16/12/15 del plan inicial estaban mal contadas.

**ADR-34 — Migraciones 035-041 corregidas antes del primer despliegue.** Se añadieron los menhires a 035 en vez de crear 042, porque 035-041 no se han aplicado nunca en producción. A partir del primer despliegue, un cambio de catálogo o de esquema es una migración nueva.

## Decisiones posteriores a la auditoría

**ADR-35 — Viudo/a depende de quién muere (`marriages.ended_by_player_id`).** Al morir un jugador su matrimonio acaba en `viudedad` con `ended_by_player_id` = el fallecido; el divorcio registra a quien divorcia y la anulación deja NULL. `civilStatusLabel` solo muestra Viudo/a si el matrimonio acabó en viudedad y el que lo terminó NO es el propio jugador, y `getCivilStatus` ignora matrimonios anteriores a `character_created_at`. Así el que murió no se queda «viudo de sí mismo» al crear otro personaje.

**ADR-36 — Un Rolepriest no actúa sobre su propio personaje.** Reglamento al Lorepriest, regla 2. `rejectSelfTarget`/`requireOtherTarget` (`src/utils/interactionContext.js`) bloquean altas, bajas, traspasos y correcciones en `/bienes-admin`, `/npcs-admin`, `/propiedades-admin` (incluido `revocar`, que compara con el dueño de la propiedad) y `/perfil-admin`; `/magia-admin` lo comprueba por su cuenta. Excepción: `/perfil-admin cooldown-creacion` no tiene objetivo. `/kill`, `/revive` y `/periodico abrir` no aplican esta guarda (`/periodico abrir` solo exige un personaje vivo). Consultar el propio perfil siempre es posible.

**ADR-37 — Corregir el menhir como Rolepriest no reinicia la espera de 6 meses.** `setMenhir` solo fija `menhir_chosen_at` cuando el jugador no tenía menhir; si ya tenía uno, lo conserva. Quitar el menhir (`clearMenhir`) borra ambos campos. El jugador que elige por sí mismo (`chooseMenhir`) siempre reinicia la espera.

**ADR-38 — Tope de 5 solicitudes pendientes por pareja.** `consentService.createRequest` cuenta las pendientes no caducadas del mismo emisor al mismo destinatario y rechaza a partir de 5. Evita inundar de MD a un jugador y acota el trabajo de `cancelAllPendingForPlayerInTx` al morir. Las solicitudes caducan a las 24 h.

**ADR-39 — Política de deadlocks.** Orden de bloqueos (filas de `players` ascendentes, después el resto), índices de FK solo sobre la columna FK (`idx_to`, `idx_from` en `consent_requests`) y `withTransaction(fn, { retryOnDeadlock: 3 })` en aceptar/crear solicitud y en la muerte. Si el deadlock persiste, `UserFacingError` («Hubo un choque con otra operación, inténtalo de nuevo»). Motivo: la actualización de `status` sobre un índice `(to_player_id, status)` tomaba bloqueos S en `players` y chocaba con la muerte de un jugador.

**ADR-40 — Las migraciones se serializan con `GET_LOCK('rp_migrations')`.** Bot y API migran al arrancar y el despliegue los levanta a la vez; sin bloqueo los dos aplicaban la misma migración. El runner espera hasta 600 s por el lock y lo libera siempre (`finally`). `ADR-30` sigue vigente: el schema sale del nombre del fichero.

**ADR-41 — `/dado` sin D10.** Dados disponibles: D6, D12, D20 y D100, que son los que usa el Tomegrama (pág. 26). El D6 es el valor por defecto. La tirada es pública (no efímera) y exige un personaje vivo.

**ADR-42 — Un solo kit de confirmación y paginación.** `confirmAction()` (`src/components/confirm.js`, 60 s, Confirmar/Cancelar) y `src/utils/paginate.js` (10 por página) sirven a todos los comandos. Piden confirmación las acciones destructivas o difíciles de revertir: `/bienes-admin quitar`, `/npcs-admin baja`, `/propiedades-admin revocar`, `/magia-admin fijar` cuando baja el nivel, `/perfil-admin raza`, `corregir-stat` y `anular-matrimonio`; y, del lado del jugador, asignar puntos, elegir menhir, proponer matrimonio y divorciarse. El resto de comandos de moderación se ejecuta directamente y deja su fila en `audit_log`.

**ADR-43 — Ensayo de migración no circular.** `scripts/rehearse-migration.mjs` aplica las migraciones hasta la 034, siembra un juego antiguo con un libro mayor independiente de las migraciones (modo fixture) o usa los datos de una MySQL ya restaurada (`--current`), aplica 035-041 y comprueba que cada unidad por fuente aparece en el destino (con truncado a 2 decimales) y que lo perdido es solo lo que no tiene dueño. No se ejecuta sobre producción.

**ADR-44 — La imprenta se abre con `/periodico abrir`.** Antes el canal-periódico nacía al fabricar un objeto en una construcción de tipo Imprenta; ese camino desapareció con el crafteo. Ahora un Rolepriest abre la imprenta de un jugador con `/periodico abrir jugador nombre`, que crea el canal en la categoría fijada con `/periodico categoria` (o `NEWSPAPER_CATEGORY_ID`) y registra la fila en `newspapers`.

**ADR-45 — Sesión web revalidada y logout por POST.** La API vuelve a comprobar en Discord que el usuario sigue teniendo el rol Rolepriest cada 10 minutos (`revalidateRolepriest`); si ya no lo tiene destruye la sesión, y si Discord no responde la mantiene. El cierre de sesión es `POST /auth/logout` (con CSRF), no un enlace GET. Hay cierre por inactividad (30 min por defecto, ajuste `web_idle_logout_minutes`).

**ADR-46 — Terminal SQL restringida.** `POST /api/terminal/sql` solo acepta una sentencia `SELECT` (sin comentarios ni `;`), rechaza `INTO OUTFILE/DUMPFILE`, `LOAD_FILE`, `SLEEP`, `BENCHMARK`, `GET_LOCK`, lecturas con bloqueo, el schema `mysql` y `web_sessions`, aplica `MAX_EXECUTION_TIME` de 5 s y devuelve como máximo 500 filas. Cada consulta queda en `audit_log` (`terminal.sql`). El terminal de comandos (`/api/terminal/command`) ejecuta comandos slash a través de un `terminal_job` que procesa el bot.

**ADR-47 — Eliminadas las referencias al juego antiguo en la documentación.** `MANUAL_STAFF.html` duplicaba la guía de Staff y describía el motor anterior; se borra junto a `docs/plan.md` y `EXECUTION_PLAN.md`. La guía de Staff vigente es `docs/guia-staff.md`, que el panel sirve en `/staff/docs`.
