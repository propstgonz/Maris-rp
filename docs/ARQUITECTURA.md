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
5. `execute` usa sentencias preparadas: `LIMIT ?` no funciona con parámetro numérico en mysql2. Valida el entero en JS (`Number.isInteger`, rango) e interpólalo.
6. Cero comentarios en el código (ver `CLAUDE.md`).

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
  end_reason ENUM('divorcio','viudedad','anulacion') NULL
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
-- 1 principiante "Principiante" 19 0 | 2 aprendiz "Aprendiz" 19 1 | 3 habil "Hábil" 21 1
-- 4 experto "Experto" 24 1 | 5 maestro "Maestro" 28 1

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
| Magia | `25 × max(0, Autismo efectivo) + menhirs.magic_bonus`; con `magic_to_life` la Magia pasa a 0 y se muestra `+ Magia/100` de Vida | `domain/picarda.js` |
| Estado civil | Casado/a si `open_slot = 1`; Viudo/a si el último matrimonio acabó en `viudedad`; Soltero/a si no | `domain/civilStatus.js` |
| Modificador de tirada | `Autismo_ef + stat2_ef / divisor` (sin redondeo) | `domain/magic.js` |
| Conjuros desbloqueados | `spells ⋈ schools(is_active=1) ⋈ school_progress` con `min_rank <= level_rank` | `magicService` |

## Módulo `domain/` (contratos exactos)

```js
// src/domain/picarda.js
export const STATS = ['potencia','intuicion','chiripa','autismo','resistencia','donjuanismo','agilidad'];
export const STAT_LABELS = { potencia:'Potencia', intuicion:'Intuición', chiripa:'Chiripa', autismo:'Autismo',
                             resistencia:'Resistencia', donjuanismo:'Donjuanismo', agilidad:'Agilidad' };
export const BASE_POINTS = 8;
export const MAX_BASE_PER_STAT = 6;
export function baseStats(playerRow)              // -> { potencia: n, ... } desde stat_*
export function modifiers(row)                   // -> { potencia: n, ... } desde mod_* de una raza o menhir (todo 0 si row es null)
export function effectiveStats(playerRow, raceRow, menhirRow) // -> base + raza + menhir
export function freePoints(playerRow)             // -> 8 + stat_bonus_points - Σ base
export function magicPoints(effective, menhirRow) // -> { magia, vidaExtra }: magia = 25*max(0,autismo)+magic_bonus; si magic_to_life: { magia: 0, vidaExtra: magia/100 }
export function validateAllocation(playerRow, stat, n) // -> null | mensaje de error (para explicar un changes===0)

// src/domain/magic.js
export const RETRY_DAYS = 28;
export function attemptModifier(effective, school)  // school: { secondary_stat, secondary_divisor }
export function isSuccess(total, threshold)         // total >= threshold
export function mentorQualifies(mentorRank, targetRank) // mentorRank >= targetRank
export function canClaimFreeSchool(effective, playerRow) // effective.autismo >= 6 && !free_school_claimed_at
export const MENHIR_CHANGE_MONTHS = 6;
export function canChangeMenhir(playerRow, now)  // sin menhir, o menhir_chosen_at + 6 meses <= now (vive en picarda.js)

// src/domain/civilStatus.js
export function civilStatusLabel({ active, lastEndReason, gender }) // 'Soltero/a' | 'Casado/a' | 'Viudo/a' (concuerda con gender si es hombre/mujer)
```

## Servicios (contratos exactos)

Todos los IDs de entrada son `players.id` salvo donde dice `discordId`. Todos lanzan `UserFacingError` ante un rechazo de regla. `actor` es `{ discordId, username, source: 'discord'|'web' }` y se usa para `logAction`.

```js
// profileService.js
getPlayerByDiscordId(discordId)            // -> fila players | undefined
requireLivingPlayer(discordId)             // -> fila players (UserFacingError si no hay personaje vivo)
getProfile(playerId)                       // -> { player, race, menhir, base, effective, freePoints, magic:{magia,vidaExtra}, menhirChangeAvailableAt, civil:{label, spouse:{id,discordId,characterName}|null} }
listRaces()                                // -> filas races ordenadas por sort
allocateStat(playerId, stat, n, actor)     // UPDATE único con guarda; n entero 1..6
grantBonusPoints(playerId, n, actor)       // Rolepriest
correctStat(playerId, stat, value, actor)  // Rolepriest; value 0..6; no puede dejar Σ > 8 + bonus
setRace(playerId, raceSlug, actor)         // Rolepriest
chooseMenhir(playerId, menhirSlug, actor)  // jugador: UPDATE único con guarda (menhir_chosen_at IS NULL OR menhir_chosen_at <= NOW() - INTERVAL 6 MONTH) y menhir distinto
setMenhir(playerId, menhirSlug|null, actor) // Rolepriest: corrección sin espera (no toca menhir_chosen_at salvo al asignar)
listMenhirs()
updateIdentity(playerId, { characterName?, age?, gender? }, actor) // Rolepriest

// marriageService.js
propose(fromPlayerId, toPlayerId, actor)            // -> consent_request id (usa consentService.createRequest)
acceptMarriageInTx(request)                         // llamado por consentService dentro de su transacción
divorce(playerId, actor)
annul(playerId, actor)                              // Rolepriest
endMarriagesOnDeathInTx(playerId)                   // llamado por characterLifecycleService dentro de su transacción
getCivilStatus(playerId)                            // -> { label, spouse|null, marriageId|null }

// consentService.js
createRequest({ kind, fromPlayerId, toPlayerId, itemId?, quantity?, npcName?, npcCount?, propertyId? }) // TTL 24h
accept(requestId, actorPlayerId, actor)   // transacción: claim pending->accepted (to_player_id = actor, expires_at > NOW()), despacho por kind
reject(requestId, actorPlayerId, actor)
cancel(requestId, actorPlayerId, actor)   // solo el emisor
cancelAllPendingForPlayerInTx(playerId)
getRequest(requestId)

// npcHoldingService.js
listGrouped(ownerId, { page, pageSize })  // -> { rows:[{name,count}], total }
addNpcs(ownerId, name, count, actor)      // count 1..50
removeNpcs(ownerId, name, count, actor)   // exige changes === count
transferNpcsInTx(fromId, toId, name, count)
adminTransferNpcs(fromId, toId, name, count, actor)

// goodsService.js
listCategories()  createCategory({name, displayName, emoji?, description?}, actor)
listTypes({ includeInactive })  findTypeByName(name)
createType({name, displayName, categoryName?, emoji?, description?}, actor)
editType(id, {...}, actor)  setTypeActive(id, isActive, actor)
listInventory(ownerId, { page, pageSize })  // -> { rows:[{item_id,display_name,emoji,category,quantity}], total }
addGoods(ownerId, itemId, quantity, actor)      // quantity > 0, 2 decimales
removeGoods(ownerId, itemId, quantity, actor)
transferGoodsInTx(fromId, toId, itemId, quantity)
adminTransferGoods(fromId, toId, itemId, quantity, actor)

// propertyService.js
listTypes({ includeInactive })  createType({...}, actor)  editType(id, {...}, actor)  setTypeActive(id, isActive, actor)
listProperties(ownerId, { page, pageSize })
getProperty(propertyId)
grantProperty(ownerId, typeId, { name?, level?, location? }, actor)
revokeProperty(propertyId, actor)
setLevel(propertyId, level, actor)
transferPropertyInTx(fromId, toId, propertyId)
adminTransferProperty(propertyId, toId, actor)

// magicService.js
listSchools({ includeInactive })
getSchoolsOverview(playerId)              // -> [{school, rank, levelName, next:{rank,name,threshold}|null, retryAfter}] + magic
claimFreeSchool(playerId, schoolSlug, actor)
authorizedRoll({ playerId, schoolSlug, mentorPlayerId, mentorLabel, actor }) // -> { roll, modifier, total, threshold, success, targetRank, retryAfter }
setLevel(playerId, schoolSlug, rank, actor)   // Rolepriest, 0..5
getUnlockedSpells(playerId, { schoolSlug, page, pageSize })
getNextSpells(playerId, schoolSlug)           // conjuros del siguiente nivel, marcados bloqueados

// characterLifecycleService.js (se reescribe)
createCharacter(discordId, username, { characterName, age, gender, raceSlug })
killCharacter(discordId, reason, actor)   // una transacción: snapshot -> vacía player_npcs, inventory, properties,
                                          // resetea stats/raza/menhir/bonus/free_school, borra school_progress,
                                          // endMarriagesOnDeathInTx, cancelAllPendingForPlayerInTx, marca muerte.
                                          // El snapshot se registra con logAction DESPUÉS del commit.
reviveCharacter(discordId, actor)
getCharacterCreationCooldownHours()       // default 336 (2 semanas, Tomegrama p. 31)
```

## Interfaz de Discord

- Componentes en `src/components/registry.js`, customId `ns:action:owner:ctx` (`src/utils/componentAuth.js`).
- Namespaces nuevos: `perfil`, `pag`, `consent`, `confirm`, `pj` (creación).
- Paginador: `src/utils/paginate.js`, 10 entradas por página, botones ◀ ▶, `ctx = <kind>.<page>.<targetPlayerId>`.
- Respuestas de consulta efímeras. Un jugador solo consulta lo suyo; un Rolepriest pasa `jugador:` para ver a otro.
- Comandos: ver `docs/COMANDOS.md`.

## Migraciones

- Fichero nuevo por cambio: `src/database/migrations/mysql/NNN_rp_<schema>_<tema>.sql`. El esquema se deduce del nombre (`rp_players`, `rp_world`, `rp_economy`, `rp_ops`).
- `splitStatements` corta en `;` + salto de línea: ningún texto de datos puede tener `;` a final de línea.
- Nunca editar una migración ya aplicada.
