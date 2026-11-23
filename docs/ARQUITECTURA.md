# Arquitectura — bot de fichas del Tomegrama

Fuente de verdad de las mecánicas: `PROMPT/El Tomegrama.pdf`. Decisiones y ambigüedades: `docs/ADR.md`.

## Procesos

Tres procesos que solo comparten MySQL. Ninguno llama a funciones de otro.

| Proceso | Entrada | Responsabilidad |
|---|---|---|
| Bot | `src/index.js` | Comandos slash, componentes, cron (backups y purga de personajes), `bot_jobs` |
| API | `src/apiServer.js` + `src/api/` | Login Discord OAuth, panel de staff (auditoría, backups, terminal, modmail, broadcast, fichas de jugador de solo lectura), SSE de staff `/api/events` |
| Web | `apps/web` | Astro SSR del panel de staff; habla solo con la API |

## Capas

```
commands/ , components/      (Discord: parseo, permisos, presentación)
        │
services/                    (reglas, transacciones, auditoría)
        │            ╲
domain/  (puro)       database/  (query, queryOne, execute, withTransaction, T)
```

- `src/domain/` no importa nada de `database/`, `discord.js` ni `services/`. Funciones puras, testeables sin mocks.
- Los servicios lanzan `UserFacingError` (`src/utils/errors.js`) para todo rechazo de regla; el mensaje es el que ve el jugador, en español.
- Los comandos no escriben SQL.
- `logAction` (`src/services/auditLogService.js`) se llama **fuera** de `withTransaction`, después del commit.

## Invariantes de escritura

1. Una reclamación es un único `UPDATE`/`DELETE` con la guarda en el `WHERE`; rechazo = `changes === 0`. Nunca `IF()` en el `SET` como guarda (`CLIENT_FOUND_ROWS`).
2. Un traspaso entre jugadores es una sola transacción: origen con guarda de dueño/cantidad, después destino.
3. Toda escritura sobre algo de un jugador lleva el dueño esperado en el `WHERE`.
4. Nada de promesas sin `await` dentro de `withTransaction`.
5. Los enteros de `LIMIT`/`OFFSET` se validan en JS y se interpolan (`goodsService`, `magicService`, `npcHoldingService`) por coherencia entre servicios. No es una limitación de mysql2 3: `auditLogService` pasa `LIMIT ?` como parámetro y funciona.
6. Orden de bloqueos: primero las filas de `players` en orden ascendente de id (`playerService.lockPlayersInTx`, `marriageService.lockCoupleInTx`), después el resto. Toda operación sobre dos jugadores (solicitudes, matrimonio, muerte) empieza así.
7. Un índice secundario con una columna FK toma bloqueos S en la tabla padre cuando se actualiza otra columna del índice. Por eso `consent_requests` indexa solo `to_player_id` y `from_player_id`, no `(to_player_id, status)`.
8. `withTransaction(fn, { retryOnDeadlock })` reintenta la transacción hasta `retryOnDeadlock` veces con espera aleatoria; si el deadlock persiste lanza `UserFacingError`. Lo piden `consentService.createRequest/accept` y `characterLifecycleService` (3 reintentos). Dentro de una transacción ya abierta no reintenta.
9. Las migraciones se serializan con `GET_LOCK('rp_migrations')` (600 s) porque bot y API migran al arrancar.
10. Cero comentarios en el código (ver `CLAUDE.md`).

## Modelo de datos (estado final tras las migraciones 035–041)

Tipos de clave: `players.id` es `INT`. Todas las FK a jugadores son `INT NOT NULL`.

### rp_players

```sql
players(
  id INT PK AUTO_INCREMENT,
  discord_id VARCHAR(191) NOT NULL UNIQUE,
  username VARCHAR(191) NOT NULL,
  character_name VARCHAR(191) NULL,
  avatar_filename VARCHAR(255) DEFAULT 'avatars/default.png',
  gender VARCHAR(16) NULL,                         -- 'hombre' | 'mujer' (existente, migración 018)
  age SMALLINT NULL CHECK (age IS NULL OR age BETWEEN 1 AND 1000),
  race_id INT NULL  FK races(id),
  menhir_id INT NULL FK menhirs(id),
  menhir_chosen_at DATETIME NULL,
  stat_potencia    TINYINT NOT NULL DEFAULT 0 CHECK (stat_potencia BETWEEN 0 AND 6),
  stat_intuicion   TINYINT NOT NULL DEFAULT 0 CHECK (stat_intuicion BETWEEN 0 AND 6),
  stat_chiripa     TINYINT NOT NULL DEFAULT 0 CHECK (stat_chiripa BETWEEN 0 AND 6),
  stat_autismo     TINYINT NOT NULL DEFAULT 0 CHECK (stat_autismo BETWEEN 0 AND 6),
  stat_resistencia TINYINT NOT NULL DEFAULT 0 CHECK (stat_resistencia BETWEEN 0 AND 6),
  stat_donjuanismo TINYINT NOT NULL DEFAULT 0 CHECK (stat_donjuanismo BETWEEN 0 AND 6),
  stat_agilidad    TINYINT NOT NULL DEFAULT 0 CHECK (stat_agilidad BETWEEN 0 AND 6),
  stat_bonus_points TINYINT NOT NULL DEFAULT 0 CHECK (stat_bonus_points >= 0),
  free_school_claimed_at DATETIME NULL,
  is_alive TINYINT(1) NOT NULL DEFAULT 1,
  died_at DATETIME NULL,
  character_created_at DATETIME NULL,
  character_reset_at DATETIME NULL,
  modmail_channel_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)

races(
  id INT PK AUTO_INCREMENT, slug VARCHAR(32) NOT NULL UNIQUE, name VARCHAR(64) NOT NULL,
  description TEXT NOT NULL, traits TEXT NULL,
  mod_potencia TINYINT NOT NULL DEFAULT 0, mod_intuicion TINYINT NOT NULL DEFAULT 0,
  mod_chiripa TINYINT NOT NULL DEFAULT 0, mod_autismo TINYINT NOT NULL DEFAULT 0,
  mod_resistencia TINYINT NOT NULL DEFAULT 0, mod_donjuanismo TINYINT NOT NULL DEFAULT 0,
  mod_agilidad TINYINT NOT NULL DEFAULT 0, sort TINYINT NOT NULL
)
-- slugs: nordico imperial breton guardia_rojo bosmer aldmer dunmer orsimer argoniano khajiita

menhirs(
  id INT PK AUTO_INCREMENT, slug VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  mod_potencia … mod_agilidad TINYINT NOT NULL DEFAULT 0,
  magic_bonus SMALLINT NOT NULL DEFAULT 0, magic_to_life TINYINT(1) NOT NULL DEFAULT 0, sort TINYINT NOT NULL
)
-- 11 menhires del Tomegrama págs. 56-57: guerrero ladron mago atronach amante torre dama ritual ofidio sombrio aprendiz

marriages(
  id INT PK AUTO_INCREMENT,
  proposed_by_player_id INT NOT NULL FK players(id),
  accepted_by_player_id INT NOT NULL FK players(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  end_reason ENUM('divorcio','viudedad','anulacion') NULL,
  ended_by_player_id INT NULL FK players(id)       -- quien divorcia o, en viudedad, el que muere
)

marriage_members(
  marriage_id INT NOT NULL FK marriages(id) ON DELETE CASCADE,
  player_id INT NOT NULL FK players(id),
  open_slot TINYINT NULL CHECK (open_slot IS NULL OR open_slot = 1),
  PRIMARY KEY (marriage_id, player_id),
  UNIQUE KEY uq_one_open_marriage (player_id, open_slot)
)

player_npcs(
  id INT PK AUTO_INCREMENT,
  owner_player_id INT NOT NULL FK players(id),
  name VARCHAR(80) NOT NULL,
  created_by_discord_id VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_owner_name (owner_player_id, name)
)

consent_requests(
  id INT PK AUTO_INCREMENT,
  kind ENUM('item','npc','property','marriage') NOT NULL,
  from_player_id INT NOT NULL FK players(id),
  to_player_id INT NOT NULL FK players(id),
  item_id INT NULL, quantity DECIMAL(14,2) NULL,
  npc_name VARCHAR(80) NULL, npc_count SMALLINT NULL,
  property_id INT NULL,
  status ENUM('pending','accepted','rejected','cancelled','expired') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  resolved_at DATETIME NULL,
  KEY idx_to (to_player_id), KEY idx_from (from_player_id)        -- sin status: cambiar status no debe reescribir una entrada de índice con FK (toma bloqueos S en players)
)

schools(
  id INT PK AUTO_INCREMENT, slug VARCHAR(32) NOT NULL UNIQUE, name VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  secondary_stat ENUM('potencia','intuicion','chiripa','autismo','resistencia','donjuanismo','agilidad') NOT NULL,
  secondary_divisor TINYINT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1, sort TINYINT NOT NULL
)
-- destruccion(autismo,2) alteracion(intuicion,1) restauracion(resistencia,1)
-- ilusion(agilidad,1) conjuracion(donjuanismo,1) encantamiento(potencia,1, is_active=0)

mastery_levels(
  `rank` TINYINT PK, slug VARCHAR(32) NOT NULL UNIQUE, name VARCHAR(64) NOT NULL,
  threshold DECIMAL(4,1) NOT NULL, requires_mentor TINYINT(1) NOT NULL
)
-- 1 principiante "Principiante" 19 1 | 2 aprendiz "Aprendiz" 19 1 | 3 habil "Hábil" 20.5 1
-- 4 experto "Experto" 24 1 | 5 maestro "Maestro" 28 1   (los cinco niveles exigen mentor, pág. 41)

school_progress(
  player_id INT NOT NULL FK players(id),
  school_id INT NOT NULL FK schools(id),
  level_rank TINYINT NOT NULL DEFAULT 0 CHECK (level_rank BETWEEN 0 AND 5),
  retry_after DATETIME NULL,
  PRIMARY KEY (player_id, school_id)
)

magic_attempts(
  id INT PK AUTO_INCREMENT,
  player_id INT NOT NULL FK players(id), school_id INT NOT NULL FK schools(id),
  target_rank TINYINT NOT NULL,
  mentor_player_id INT NULL, mentor_label VARCHAR(120) NULL,
  authorized_by_discord_id VARCHAR(191) NOT NULL,
  roll TINYINT NOT NULL, modifier DECIMAL(5,1) NOT NULL, total DECIMAL(5,1) NOT NULL,
  threshold DECIMAL(4,1) NOT NULL, success TINYINT(1) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)

spells(
  id INT PK AUTO_INCREMENT,
  school_id INT NOT NULL FK schools(id),
  min_rank TINYINT NOT NULL FK mastery_levels(`rank`),
  name VARCHAR(100) NOT NULL,
  cost_amount DECIMAL(6,2) NOT NULL,
  cost_resource ENUM('magia','vida') NOT NULL DEFAULT 'magia',
  description TEXT NOT NULL,
  sort SMALLINT NOT NULL,
  UNIQUE KEY uq_school_spell (school_id, name)
)

character_registry, newspapers      -- se conservan sin cambios
```

### rp_economy

```sql
item_categories(id, name UNIQUE, display_name, emoji, description, created_at)   -- se conserva
items(
  id INT PK, name VARCHAR(191) UNIQUE, display_name VARCHAR(191) NOT NULL,
  description TEXT NULL, emoji VARCHAR(32) NULL,
  category_id INT NULL FK item_categories(id),
  is_active TINYINT(1) NOT NULL DEFAULT 1, created_at
)
inventory(
  id INT PK, player_id INT NOT NULL, item_id INT NOT NULL FK items(id),
  quantity DECIMAL(14,2) NOT NULL CHECK (quantity > 0),
  UNIQUE(player_id, item_id)
)                                     -- player_id cruza esquema: integridad en la aplicación
```

### rp_world

```sql
property_types(
  id INT PK, name VARCHAR(191) UNIQUE, display_name VARCHAR(191) NOT NULL,
  category VARCHAR(16) NOT NULL DEFAULT 'vivienda' CHECK (category IN
    ('vivienda','ganaderia','infraestructura','ocio','produccion','extraccion','religion','educacion','naval','terreno')),
  description TEXT NULL, emoji VARCHAR(32) NULL, is_active TINYINT(1) NOT NULL DEFAULT 1, created_at
)
properties(
  id INT PK, owner_player_id INT NOT NULL, property_type_id INT NOT NULL FK property_types(id),
  name VARCHAR(191) NULL, level SMALLINT NOT NULL DEFAULT 1 CHECK (level >= 1),
  location VARCHAR(100) NULL, created_at,
  KEY idx_owner (owner_player_id)
)                                     -- owner_player_id cruza esquema: integridad en la aplicación
```

### rp_ops

Sin cambios de estructura: `audit_log`, `bot_jobs`, `terminal_jobs`, `system_state`, `web_sessions`, `modmail_categories`, `schema_migrations`.

### Derivado, nunca almacenado

| Dato | Regla | Dónde |
|---|---|---|
| Estadística efectiva | base + `races.mod_*` + `menhirs.mod_*` (puede pasar de 6 o ser negativa) | `domain/picarda.js` |
| Puntos libres | `8 + stat_bonus_points − Σ base` | `domain/picarda.js` |
| Magia | `min(25 × max(0, Autismo efectivo), 150 + 25 × max(0, races.mod_autismo)) + menhirs.magic_bonus`; con `magic_to_life` la Magia pasa a 0 y se muestra `+ Magia/100` de Vida. El tope es literal del PDF y solo depende del bono racial: el Menhir del Aprendiz (+1 Autismo) no lo rompe y el del Mago suma aparte | `domain/picarda.js` |
| Estado civil | Casado/a si `open_slot = 1`; Viudo/a si el último matrimonio (posterior a `character_created_at`) acabó en `viudedad` y `ended_by_player_id` no es el propio jugador (el que muere no queda viudo de sí mismo); Soltero/a si no | `domain/civilStatus.js` |
| Modificador de tirada | `Autismo_ef + stat2_ef / divisor` (sin redondeo) | `domain/magic.js` |
| Conjuros desbloqueados | `spells ⋈ schools(is_active=1) ⋈ school_progress` con `min_rank <= level_rank` | `magicService` |

## Módulo `domain/` (exports reales)

```js
// src/domain/picarda.js
STATS, STAT_LABELS, BASE_POINTS = 8, MAX_BASE_PER_STAT = 6, MAGIC_PER_AUTISMO = 25, MAGIC_BASE_CAP = 150, MENHIR_CHANGE_MONTHS = 6
isStat(stat)
baseStats(playerRow)                       // -> { potencia: n, ... } desde stat_*
modifiers(row)                             // -> mod_* de una raza o menhir (todo 0 si row es null)
effectiveStats(playerRow, raceRow, menhirRow)
spentPoints(playerRow)  freePoints(playerRow)   // 8 + stat_bonus_points - Σ base
magicPoints(effective, menhirRow, raceRow) // -> { magia, vidaExtra }; tope 150 + 25 * max(0, raceRow.mod_autismo)
validateAllocation(playerRow, stat, n)     // -> null | mensaje (explica un changes === 0)
menhirChangeAvailableAt(playerRow)  canChangeMenhir(playerRow, now)

// src/domain/magic.js
RETRY_DAYS = 28, FREE_SCHOOL_MIN_AUTISMO = 6, MAX_RANK = 5
attemptModifier(effective, school)         // Autismo + stat secundaria / divisor, sin redondeo
isSuccess(total, threshold)                // total >= threshold
thresholdLabel(threshold)                  // "19 o más" | "más de 20" (para 20,5)
mentorQualifies(mentorRank, targetRank)    // mentorRank >= targetRank
canClaimFreeSchool(effective, playerRow)

// src/domain/civilStatus.js
civilStatusLabel({ active, lastEndReason, endedByPlayerId, playerId, gender })
```

## Servicios (exports reales)

Los IDs de entrada son `players.id` salvo donde dice `discordId`. Los rechazos de regla son `UserFacingError`. `actor` es `{ discordId, username, source: 'discord' | 'web' }`; se pasa tal cual a `logAction({ actor, action, target, details })`.

```js
// playerService.js
getPlayerByDiscordId(discordId)  listPlayers()  findPlayerById(id)
lockPlayersInTx(ids)                       // SELECT ... FOR UPDATE ordenado por id

// profileService.js
getPlayerByDiscordId (reexportada)
listRaces()  listMenhirs()
getProfile(playerId)                       // -> { player, race, menhir, base, effective, freePoints, magic:{magia,vidaExtra}, menhirChangeAvailableAt, civil:{label, spouse} }
allocateStat(playerId, stat, n, actor)     // UPDATE único con guarda en el WHERE
grantBonusPoints(playerId, n, actor)       // Rolepriest
correctStat(playerId, stat, value, actor)  // Rolepriest; value 0..6; no puede dejar Σ > 8 + bonus
setRace(playerId, raceSlug, actor)         // Rolepriest
chooseMenhir(playerId, menhirSlug, actor)  // jugador: guarda menhir_chosen_at <= NOW() - INTERVAL 6 MONTH y menhir distinto
setMenhir(playerId, menhirSlug|null, actor) // Rolepriest: sin espera; menhir_chosen_at solo se fija si no había menhir
setAvatar(playerId, relativeFilename, actor)
updateIdentity(playerId, { characterName?, age?, gender? }, actor)

// marriageService.js
propose(fromPlayerId, toPlayerId, actor)   // -> id de la solicitud (consentService.createRequest)
acceptMarriageInTx(request)                // lo llama consentService.accept dentro de su transacción
divorce(playerId, actor)  annul(playerId, actor)   // anulación: Rolepriest
endMarriagesOnDeathInTx(playerId)          // viudedad, ended_by_player_id = el que muere
getCivilStatus(playerId)                   // -> { label, spouse|null, marriageId|null }
findSpouseId(playerId)  lockCoupleInTx(playerId, hintSpouseId)

// consentService.js
createRequest({ kind, fromPlayerId, toPlayerId, itemId?, quantity?, npcName?, npcCount?, propertyId? })
                                           // TTL 24 h; máximo 5 pendientes por pareja (de, a); ambos vivos
accept(requestId, actorPlayerId, actor)    // claim pending->accepted + traspaso en una transacción (retryOnDeadlock 3)
reject(requestId, actorPlayerId, actor)  cancel(requestId, actorPlayerId, actor)  // cancel: solo el emisor
getRequest(requestId)  listPendingForPlayer(playerId)  cancelAllPendingForPlayerInTx(playerId)

// npcHoldingService.js
listGrouped(ownerId, { page, pageSize })   // -> { rows:[{name,count}], total }
addNpcs(ownerId, name, count, actor)  removeNpcs(ownerId, name, count, actor)   // count 1..50
transferNpcsInTx(fromId, toId, name, count)  adminTransferNpcs(fromId, toId, name, count, actor)

// goodsService.js
validateQuantity(quantity)                 // > 0, hasta 2 decimales
listCategories()  createCategory({ name, displayName, emoji?, description? }, actor)
listTypes({ includeInactive })  findTypeByName(name)  searchTypes(text, limit, opts)
createType({ name, displayName, categoryName?, emoji?, description? }, actor)
editType(id, { displayName, categoryName, emoji, description }, actor)  setTypeActive(id, isActive, actor)
listInventory(ownerId, { page, pageSize }) // -> { rows:[{item_id, display_name, emoji, is_active, category, quantity}], total }
addGoods(ownerId, itemId, quantity, actor)  removeGoods(ownerId, itemId, quantity, actor)
transferGoodsInTx(fromId, toId, itemId, quantity)  adminTransferGoods(fromId, toId, itemId, quantity, actor)

// propertyService.js
PROPERTY_CATEGORIES
listTypes({ includeInactive })  searchTypes(text, limit, opts)  createType({ name, displayName, category, emoji, description }, actor)
editType(id, fields, actor)  setTypeActive(id, isActive, actor)
listProperties(ownerId, { page, pageSize })  getProperty(propertyId)
grantProperty(ownerId, typeId, { name?, level?, location? }, actor)
revokeProperty(propertyId, expectedOwnerId, actor)   // el dueño esperado va en el WHERE
setLevel(propertyId, level, actor)
transferPropertyInTx(fromId, toId, propertyId)  adminTransferProperty(propertyId, toId, actor)

// magicService.js
listSchools({ includeInactive })
getSchoolsOverview(playerId)               // -> { schools:[{school, rank, levelName, next:{rank,name,threshold,requiresMentor}|null, retryAfter, active}], magic:{magia,vidaExtra}, canClaimFreeSchool }
claimFreeSchool(playerId, schoolSlug, actor)        // -> { school, name, rank: 1 }
authorizedRoll({ playerId, schoolSlug, mentorPlayerId?, mentorLabel?, actor })
                                           // -> { roll, modifier, total, threshold, success, targetRank, levelName, retryAfter }
setLevel(playerId, schoolSlug, rank, actor)         // Rolepriest, 0..5 -> { school, rank, levelName }
getUnlockedSpells(playerId, { schoolSlug, page, pageSize })  // -> { rows, total, schoolName, magicToLife }
getNextSpells(playerId, schoolSlug)        // conjuros del siguiente nivel

// characterLifecycleService.js
hasCharacter(discordId)  getCharacterHistory(discordId)  relinkModmailChannel(discordId, channelId)
getCharacterCreationCooldownHours()  setCharacterCreationCooldownHours(hours, actor)   // por defecto 336
getCreationWaitSeconds(discordId)
createCharacter(discordId, username, { characterName, age, gender, raceSlug }, { guild })
enterGraceDeath(discordId, reason, actor)           // gracia de 7 días: is_alive = 0, nada se vacía
reviveCharacter(discordId, actor)  reviveByCharacterId(playersRowId, actor)  reviveOnReturn(discordId)
killCharacter(discordId, reason, actor, { require })  // muerte definitiva en una transacción (retryOnDeadlock 3)
markDeceased(client, discordId, reason, { permadeath, actor })  // gracia o definitiva + avisos
finalizeGraceDeath(discordId, client, actor)        // un Rolepriest adelanta la muerte definitiva
pruneExpiredCharacters(client)                      // cron 00:30 UTC: gracias vencidas -> definitiva
```

`killCharacter` es una transacción: cancela solicitudes pendientes, hace el snapshot (personaje, estadísticas, NPCs, bienes, propiedades, escuelas, cónyuge), vacía los tres inventarios y `school_progress`, resetea estadísticas, raza, menhir, puntos extra y escuela gratuita, cierra el matrimonio como viudedad y deja la fila en blanco con `died_at` intacto (o `NOW()` si venía vivo). El snapshot se registra con `logAction` DESPUÉS del commit (`personaje.muerte`).

## Interfaz de Discord

- Componentes en `src/components/registry.js`, customId `ns:action:owner:ctx` (`src/utils/componentAuth.js`).
- Un solo kit: `confirmAction()` (`src/components/confirm.js`, botones Confirmar/Cancelar, 60 s) y el paginador `src/utils/paginate.js` (10 por página, namespace `pag`).
- Respuestas de consulta efímeras. Un jugador solo consulta lo suyo; un Rolepriest pasa `jugador:` para ver a otro (`resolveViewTarget`).
- Un Rolepriest no actúa sobre su propio personaje (`rejectSelfTarget`, `requireOtherTarget` en `src/utils/interactionContext.js`).
- Comandos: ver [COMANDOS.md](COMANDOS.md).

## Migraciones

- Fichero nuevo por cambio: `src/database/migrations/mysql/NNN_rp_<schema>_<tema>.sql`. El esquema se deduce del nombre (`rp_players`, `rp_world`, `rp_economy`, `rp_ops`).
- `splitStatements` corta en `;` + salto de línea: ningún texto de datos puede tener `;` a final de línea.
- Nunca editar una migración ya aplicada. Los catálogos del PDF se siembran en migraciones; un cambio de mecánica es una migración nueva.
- El runner toma `GET_LOCK('rp_migrations')` antes de aplicar nada.
