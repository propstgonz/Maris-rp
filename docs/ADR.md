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

**ADR-09 [usuario] — Menhires.** El Tomegrama no los define todavía. Catálogo vacío; solo un Rolepriest asigna menhir; el perfil muestra «Pendiente». Cuando lleguen, solo hay que insertar datos.

**ADR-10 [usuario] — Estado civil = matrimonio.** El Tomegrama no define estados civiles. Soltero/a por defecto; Casado/a con otro jugador registrado y vivo, por solicitud y aceptación; monógamo; divorcio por cualquiera de las partes; Viudo/a si muere el cónyuge; el Rolepriest puede anular.

**ADR-11 — Integridad del matrimonio en la BD.** Un solo registro `marriages` compartido por ambas partes y `UNIQUE(player_id, open_slot)` en `marriage_members`. Es imposible tener dos matrimonios vigentes o que un perfil muestre la relación y el otro no.

## Magia

**ADR-12 [usuario] — Cinco escuelas activas; Encantamiento inactiva.** El PDF habla de seis y excluye Encantamiento «hasta nuevo aviso» (pág. 51). Queda en el catálogo con `is_active = 0` y sin conjuros.

**ADR-13 [usuario] — Las tiradas usan la estadística efectiva (base + raza).**

**ADR-14 [usuario] — Escuela gratuita con Autismo efectivo ≥ 6.** Una sola vez por personaje (`free_school_claimed_at`).

**ADR-15 [usuario] — Tiradas de dominio: el Rolepriest autoriza, el bot tira.** El Rolepriest valida al mentor (puede ser NPC). Si el mentor es un jugador, el bot comprueba su nivel. Reclamación, tirada, resultado y enfriamiento van en una transacción.

**ADR-16 — Umbrales (pág. 43).** Entrar en una escuela (Principiante) ≥19; Aprendiz ≥19; Hábil «mayor a 20» ⇒ ≥21; Experto ≥24; Maestro ≥28.

**ADR-17 — Mentor.** Nivel del mentor ≥ nivel objetivo. Para Maestro el PDF pide «igual nivel», que coincide porque Maestro es el máximo. Para entrar en una escuela no se exige mentor por nivel (no tiene sentido comparar), pero se registra.

**ADR-18 — Destrucción suma Autismo/2 sin redondear.** El umbral se compara con el decimal.

**ADR-19 — Enfriamiento de 4 semanas = 28 días reales, por (jugador, escuela).** El tiempo «semana» del Tomegrama en mecánicas es tiempo off-rol (Reclutamiento: «por semana (o en 7 días por defecto)»).

**ADR-20 — Los conjuros desbloqueados se calculan, no se guardan.** El nivel de dominio implica el acceso; una tabla de desbloqueos podría desincronizarse. Calcularlo hace imposible un desbloqueo ilegítimo y mantiene la coherencia si el nivel cambia.

**ADR-21 — Magia = 25 × Autismo efectivo.** Pág. 41. Con base ≤ 6 los topes 150/175/200 salen solos.

## Inventarios

**ADR-22 — Tres inventarios en tablas distintas.** `player_npcs`, `rp_economy.inventory` y `rp_world.properties`. Comparten solo el mecanismo de solicitud (`consent_requests`).

**ADR-23 — NPCs sin estadísticas.** Una fila = un NPC con nombre. Unidades de población, rangos militares y oficios se expresan en el nombre si hace falta.

**ADR-24 — Cantidades decimales.** El Tomegrama usa 0,5 (hierro fundido, toneladas de comida). `DECIMAL(14,2)`.

**ADR-25 — Clasificación.** Barcos, galeras y buques son propiedades (categoría naval; se pueden arrendar). El ganado es un bien (categoría Ganado). Platas es un bien de la categoría Moneda.

**ADR-26 — Límites por ciudad no se hacen cumplir.** `location` es texto libre informativo.

**ADR-27 — Catálogo inicial opcional.** `npm run seed:tomegrama` inserta (por nombre, idempotente) los bienes y edificios que nombra el PDF. No se ejecuta solo para no duplicar el catálogo de producción.

## Ciclo de vida

**ADR-28 [usuario] — Al morir se vacía todo.** Los tres inventarios, las estadísticas, la raza, el menhir y el progreso mágico. Se guarda una instantánea en `audit_log`. El cónyuge queda Viudo/a. Si hay herencia narrativa, el Rolepriest la traspasa antes del kill. Motivo: Reglamento regla 4 (sin lucro post mortem).

**ADR-29 — 2 semanas de espera tras la muerte.** Mecánica RED regla 1. El valor por defecto de `character_creation_cooldown_hours` pasa a 336.

## Técnica

**ADR-30 — `migrate.js` deduce el esquema del nombre del fichero.** Elimina el mapa manual `FILE_SCHEMA`, que hacía fallar el arranque si alguien olvidaba registrar una migración.

**ADR-31 — Renombrado mapServer → API.** `src/mapServer.js` → `src/apiServer.js`, `src/mapServer/` → `src/api/`, servicio `rp-map-editor` → `rp-api`, variables `MAP_SERVER_*` → `API_*`. El host DNS público no cambia.

**ADR-32 — Migración de datos sin pérdida de bienes.** NPCs con dueño → `player_npcs`; construcciones → `properties`; contenido de almacenes de construcciones, NPCs y facciones → inventario del dueño. Lo que estaba en el suelo del mapa (`tile_items`) se pierde: no tiene dueño.
