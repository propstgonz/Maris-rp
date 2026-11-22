# Plan — Estandarizar Ricardana RP como motor data-driven a prueba de diseñadores

## Contexto

El motor ya es data-driven: casi todo el juego (ítems, construcciones, NPCs,
terrenos, estados, mecánicas) vive en BD y se configura desde el panel web.
Pero el panel se construyó como *espejo de los comandos de Discord*, no como
herramienta para un usuario no técnico. Hoy el diseñador puede dejar el mundo
en estados incoherentes sin enterarse, y solo se descubre cuando un jugador
se topa con ello en Discord.

Este plan cierra ese hueco en tres fases independientes y desplegables por
separado, de menor a mayor riesgo.

### Corrección de premisa (importante para quien ejecute)

El brief de origen decía "SQLite (`better-sqlite3` en modo WAL)". **Es
incorrecto y desactualizado.** `better-sqlite3` no figura en `package.json`;
el motor real es **MySQL vía `mysql2/promise`** (`src/database/index.js`), con
cuatro schemas por dominio y migraciones versionadas en
`src/database/migrations/mysql/`. Todo el DDL de este plan es MySQL. Quedan
comentarios obsoletos que mencionan SQLite en el código (p. ej.
`src/mapServer/state/mapCache.js`, `constructionTypeService.js`); no son
fuente de verdad.

---

## Diagnóstico (hallazgos que justifican cada fase)

**Fase A — la web no heredó la disciplina de errores del bot.**
`src/mapServer/utils/handler.js` envuelve ~55 de 79 rutas y traduce
**cualquier** excepción a `400 { error: err.message }` crudo. Un
`ER_NO_REFERENCED_ROW_2` de MySQL y un `Cannot read properties of undefined`
llegan igual de crudos al diseñador, indistinguibles de una validación
legítima. El bot **sí** hace lo correcto: `src/events/interactionCreate.js`
(líneas 114 y 192) distingue `UserFacingError` (`src/utils/errors.js`) de un
bug real y solo enseña el primero. La Fase A lleva ese patrón ya existente a
la web.

**Fase B — 19 referencias cruzan schemas sin ninguna FK real.** Por diseño
(CLAUDE.md), las FK solo existen *dentro* de cada schema; lo que cruza se
garantiza en la capa de aplicación — y hoy casi nada lo garantiza. Inventario
verificado en las migraciones:

- **Por id (14):** `tile_resource_generators.item_id`,
  `construction_types.grants_resource_item_id` / `.use_result_item_id` /
  `.fuel_item_id` / `.maintenance_item_id`,
  `construction_type_ingredients.ingredient_item_id`,
  `npc_types.weapon_item_id`, `npc_type_drops.item_id`,
  `npc_type_equipment.item_id`, `npcs.equipped_tool_item_id`,
  `tile_items.item_id`, `construction_storage.item_id`, `npc_storage.item_id`,
  `terrain_type_resources.item_id`.
- **Por NOMBRE (2, peor):** `construction_types.use_tool_item_name`,
  `construction_types.durability_repair_tool_item_name`.
- **Texto libre acoplado (1):** `construction_types.requires_resource_type` ↔
  `map_tiles.resource_type`.
- **A recetas (2):** `construction_types.unlocks_recipe_id`,
  `constructions.unlocks_recipe_id`.

**Fase C — solo ~7,5% del panel usa el camino estandarizado.** De ~53
formularios de escritura, **4** pasan por `openCatalogForm()`
(`catalogModal.ts`); el resto es `panel.innerHTML = …` a mano. Un único
catálogo está 100% estandarizado (`effectCatalog.ts`, el más simple).
Consecuencias concretas ya verificadas:

- **Cero validación de cliente** en los seis catálogos: ni un `required`, ni
  un `pattern`, ni un `min`/`max` emitido por `fieldHtml()`.
- **`escapeHtml()` no escapa comillas** (`apps/web/src/scripts/html.ts`) pero
  `fieldHtml()` lo usa **dentro de atributos** (líneas 41, 49, 56): un
  `display_name` con `"` trunca el input al reabrir, y al guardar el valor
  truncado pisa el bueno. La rama `number` (línea 53) interpola sin escapar.
- **Filas a medias se descartan en silencio** y el formulario responde
  "✅ Guardado": `readIngredients`/`readDrops`/`readEquipment` filtran con
  `quantity > 0`, y `updateConstructionTypeIngredients` es reemplazo total —
  **un despiste borra todos los ingredientes de una receta y confirma éxito**.
- **Duplicados silenciosos**: no hay UNIQUE en `recipe_ingredients` ni en
  `construction_type_ingredients`; elegir "madera ×5" dos veces hace que la
  receta cueste 10 sin avisar.
- **`<select>` con valor no coincidente** muestra la primera opción; el
  diseñador guarda un valor que nunca eligió.
- **`NaN` → `null` en JSON**: un número mal escrito llega al backend como
  "borrar este campo".
- **Doble submit posible** (el botón nunca se deshabilita): el error del
  segundo envío pisa el "✅ Guardado" del primero.
- **`readField()` colapsa vacío a `null` siempre** (línea 88): la capa de
  formularios no puede expresar "no tocar" vs "borrar". Es la causa
  estructural del bug de `resource_type` ya corregido en `mapService.js`.

---

## Decisiones de producto (confirmadas con el usuario)

1. **Avisar siempre, bloquear nunca.** El guardado nunca se impide por una
   incoherencia de diseño; se devuelven avisos. Un diseñador necesita guardar
   en estados intermedios (crear el ítem antes que la receta que lo usa).
2. **Superficie:** panel de salud en `/` (Inicio) + distintivo por fila en las
   tablas de catálogo. Sin página propia ni comando de Discord por ahora.
3. **Entrega en tres fases secuenciales** A → B → C.

---
## FASE A — Blindaje de errores (riesgo cero para el juego)

Objetivo: que ninguna configuración inconsistente ni ningún bug interno llegue
al diseñador como texto técnico, ni tumbe un comando de Discord.

### A.1 — `src/mapServer/utils/handler.js`: distinguir error de usuario de bug

Reescribir `handler()` para replicar la disciplina de `interactionCreate.js`:

```js
// Contrato de salida:
//   UserFacingError        → 400 { error: err.message }        (mensaje literal)
//   Error de MySQL conocido→ 400 { error: <traducción legible> }
//   Cualquier otra cosa    → 500 { error: 'Error interno del servidor.' }
//                            + logger.error con el stack real
```

Tabla de traducción MySQL → español (nueva, en el mismo archivo o en
`src/mapServer/utils/dbErrors.js`):

| `err.code` | Mensaje al diseñador |
|---|---|
| `ER_DUP_ENTRY` | "Ya existe un registro con ese nombre o clave única." |
| `ER_NO_REFERENCED_ROW_2` / `ER_NO_REFERENCED_ROW` | "Estás apuntando a algo que ya no existe. Refresca la página y vuelve a intentarlo." |
| `ER_ROW_IS_REFERENCED_2` / `ER_ROW_IS_REFERENCED` | "No se puede borrar: hay otras cosas que dependen de esto." |
| `ER_CHECK_CONSTRAINT_VIOLATED` | "Un valor está fuera del rango permitido." |
| `ER_DATA_TOO_LONG` | "Un texto es demasiado largo para ese campo." |
| `ER_BAD_NULL_ERROR` | "Falta un campo obligatorio." |
| `ER_TRUNCATED_WRONG_VALUE` / `ER_WARN_DATA_OUT_OF_RANGE` | "Un número no tiene un formato válido." |

**Riesgo a vigilar:** hoy los servicios lanzan `new Error(...)` (no
`UserFacingError`) con mensajes excelentes y en español que el panel ya
muestra. Convertirlos todos a 500 de golpe sería una regresión grave de UX.
**Mitigación:** en esta fase, un `Error` genérico se sigue tratando como 400
con su mensaje (comportamiento actual), y solo los errores **de driver MySQL**
(los que traen `err.code` empezando por `ER_` o `err.sqlState`) y los
`TypeError`/`ReferenceError` pasan a 500 genérico. La migración de servicios a
`UserFacingError` ya está documentada como incremental en `src/utils/errors.js`
y se sigue haciendo al tocar cada archivo, no en esta pasada.

### A.2 — `apps/web/src/scripts/api.ts`: capturar el fallo de red

`apiFetch()` propaga hoy un `TypeError: Failed to fetch` crudo (el diseñador ve
"❌ Failed to fetch" en inglés). Envolver el `fetch` en try/catch y lanzar
`new ApiError(0, 'No se pudo contactar con el servidor. Comprueba tu conexión
y vuelve a intentarlo.')`.

### A.3 — Degradación elegante en el bot ante referencias colgantes

Auditar y blindar los puntos donde una referencia rota reventaría un comando.
Archivos: `src/services/productionService.js`,
`src/services/constructionUseService.js`,
`src/services/resourceGatherService.js`,
`src/services/npcProductionService.js`,
`src/services/constructionMaintenanceService.js`.

Patrón a aplicar en cada uno: cuando un JOIN a `items` devuelva `NULL` para una
referencia que el tipo declara como configurada, lanzar
`UserFacingError('**<nombre>** está mal configurado (le falta un ítem que ya no
existe). Avisa a Staff.')` + `logger.warn` con el id concreto, en vez de dejar
que explote más abajo con un `undefined`.

**Verificación de esta fase:** `npm run test:unit`, `npm run test:commands`, y
prueba manual de forzar un 500 real en una ruta (p. ej. romper temporalmente un
nombre de columna) y comprobar que el panel muestra "Error interno del
servidor." y el stack queda solo en el log.

---

## FASE B — Motor de validación cruzada ("Doctor del mundo")

Objetivo: que el diseñador vea los callejones sin salida en la web, antes de
que un jugador los encuentre en Discord.

### B.1 — Contrato de datos

```ts
// apps/web/src/lib/mapServerApi.ts (y espejo JSDoc en el servicio)
export type IntegritySeverity = 'error' | 'warning' | 'info';

export interface IntegrityFinding {
  rule: string;              // id estable de la regla, p.ej. 'dangling_item_ref'
  severity: IntegritySeverity;
  entity: 'item' | 'construction_type' | 'npc_type' | 'terrain_type' | 'recipe' | 'tile';
  entityName: string;        // clave con la que casar la fila del catálogo
  message: string;           // legible para un diseñador, en español
  hint?: string;             // cómo arreglarlo
}

export interface IntegrityReport {
  findings: IntegrityFinding[];
  counts: { error: number; warning: number; info: number };
  generatedAt: string;       // ISO
}
```

### B.2 — `src/services/worldIntegrityService.js` (nuevo)

```js
export async function runWorldIntegrityChecks(opts = {}) // → IntegrityReport
// opts.scope?: { entity: string, entityName: string }
//   Sin scope  → mundo entero (para el panel de Inicio).
//   Con scope  → solo las reglas que afectan a esa entidad (para el aviso
//                inmediato al guardar). Debe ser barato: es la ruta caliente.
```

Cada regla es una función pura por consulta, registrada en un array
`RULES = [...]`, para poder añadir reglas sin tocar el orquestador. Reglas
mínimas de esta fase, en orden de valor:

| # | `rule` | Severidad | Qué detecta |
|---|---|---|---|
| 1 | `dangling_item_ref` | error | Cualquiera de las 14 referencias por id apuntando a un `items.id` inexistente. Una consulta por columna, con `LEFT JOIN items ON ... WHERE i.id IS NULL`. |
| 2 | `dangling_item_name_ref` | error | `use_tool_item_name` / `durability_repair_tool_item_name` con un nombre que no existe en `items.name`. |
| 3 | `dangling_recipe_ref` | error | `unlocks_recipe_id` apuntando a una receta borrada. |
| 4 | `unobtainable_required_item` | error | Ítem que NO se puede obtener por ninguna vía (sin receta, sin `npc_type_drops`, sin `tile_resource_generators`, sin `terrain_type_resources`, sin `use_result_item_id`, sin `grants_resource_item_id`) y que SÍ es requerido como ingrediente, herramienta, munición, combustible, mantenimiento o equipo de NPC. |
| 5 | `impossible_resource_requirement` | warning | `construction_types.requires_resource_type = 'X'` sin ninguna `map_tiles.resource_type = 'X'`. Comparar ya normalizado (ambos lados se guardan en minúsculas/sin espacios desde el fix reciente en `mapService.js`/`constructionTypeService.js`). |
| 6 | `unreachable_terrain` | warning | `terrain_types.requires_vehicle_category = 'X'` sin ningún ítem con `item_type='vehiculo'` y esa categoría. |
| 7 | `incomplete_config` | warning | Configuración a medias: `fuel_item_id` sin `fuel_consumption_rate`; `maintenance_item_id` sin `maintenance_rate`; `grants_resource_item_id` sin `grants_resource_rate`; `use_result_item_id` con las 6 caras del dado a 0/NULL (nunca da nada); `durability_repair_tool_item_name` sin `durability_loss_per_day`. |
| 8 | `fuel_item_not_marked` | warning | `fuel_item_id` apuntando a un ítem sin `is_fuel = 1`. |
| 9 | `craft_cycle` | warning | Receta de A que exige la construcción B, y B tiene a A entre sus ingredientes. Detección a 1 nivel (suficiente para el caso real; documentar que no busca ciclos profundos). |
| 10 | `terrain_without_resources` | info | Terreno sin ninguna fila en `terrain_type_resources` (`/recolectar` no dará nada ahí). |

### B.3 — Ruta y superficies

- **Router nuevo** `src/mapServer/routes/worldIntegrity.js`, montado en
  `src/mapServer.js` junto al resto (`app.use(createWorldIntegrityRouter())`).
  `GET /api/world-integrity` con `requireAuth`, envuelto en `handler()`.
- **Avisos al guardar (no bloqueantes):** en las rutas PATCH/POST de
  `items.js`, `constructionTypes.js`, `npcs.js`, `terrainTypes.js`, añadir al
  cuerpo de la respuesta `warnings: IntegrityFinding[]` calculado con
  `runWorldIntegrityChecks({ scope })`. Nunca cambia el código HTTP: el
  guardado ya ocurrió.
- **Panel de Inicio** (`apps/web/src/pages/index.astro`): resolver el informe
  en el frontmatter (SSR, ya es `output: 'server'`) y pintar un bloque de
  salud agrupado por severidad, con enlace al catálogo de cada hallazgo.
- **Distintivo por fila:** extender `apps/web/src/scripts/adminTable.ts` con
  una opción nueva, sin romper los usos actuales:

```ts
export interface AdminTableOptions<T> {
  // ...lo actual
  rowStatus?: (row: T) => { severity: IntegritySeverity; message: string } | null;
}
```
  Emite un icono al inicio de la fila con `title` = mensaje. Los catálogos le
  pasan un `Map<entityName, IntegrityFinding[]>` obtenido del informe.
- **Mostrar los `warnings` del guardado** en el `<p>` de estado de cada
  formulario, tras el "✅ Guardado.", en tono de aviso (no de error).

### B.4 — Migración `016_rp_economy_ingredient_unique.sql`

UNIQUE para cortar los duplicados silenciosos:

```sql
-- Deduplicar ANTES del ALTER (si hay duplicados, el ALTER falla).
-- Conserva la fila de menor id y suma las cantidades de las repetidas.
ALTER TABLE recipe_ingredients
  ADD UNIQUE KEY idx_recipe_ingredient_unique (recipe_id, ingredient_item_id);
```
Y la equivalente en `rp_world` para
`construction_type_ingredients (construction_type_id, ingredient_item_id)`
(archivo aparte: cada migración toca un solo schema, ver `FILE_SCHEMA` en
`src/database/migrate.js` — registrar ambos ahí).

**Riesgo:** si la BD de producción ya tiene duplicados, el `ALTER` falla y
bloquea el arranque. El script de deduplicación debe ir **en la misma
migración, antes del ALTER**, y hay que probarlo contra una copia real.

**Verificación de esta fase:** tests unitarios de cada regla con BD falsa
(`test/helpers/mockDb.mjs`, patrón de `test/mapService.test.mjs`), sembrar a
mano una referencia colgante y comprobar que aparece en `/` y en la fila del
catálogo.

---

## FASE C — Formularios a prueba de fallos

Objetivo: que rellenar datos sea difícil de hacer mal, y que el panel deje de
tener 49 formularios artesanales divergentes.

### C.1 — Corregir el escapado (bug real, hacer primero y solo)

`apps/web/src/scripts/html.ts`: añadir `escapeAttr()` que además escape `"` y
`'`, y usarlo en `fieldHtml()` (líneas 41, 49, 56) y en la rama `number`
(línea 53, hoy sin escapar). **No** cambiar `escapeHtml()` en sí: se usa en
contexto de nodo de texto en decenas de sitios y ahí es correcto.

### C.2 — Extender el contrato `FieldSpec` (todo opcional, sin romper nada)

```ts
export interface FieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'integer' | 'checkbox' | 'select' | 'textarea' | 'color';
  options?: FieldOption[];
  disabled?: boolean;
  dependsOn?: string;
  maxLength?: number;
  // — NUEVO —
  required?: boolean;        // marca visual + bloqueo de submit
  min?: number;              // 'number' | 'integer'
  max?: number;
  pattern?: string;          // 'text' — p.ej. clave interna ^[a-z0-9_-]+$
  patternHint?: string;      // qué explicar si falla el pattern
  hint?: string;             // ayuda contextual bajo el campo
  placeholder?: string;
  emptyMeans?: 'omit' | 'null';  // ver C.4. Por defecto 'null' (compatible)
  dependsOnValue?: string;   // dependsOn contra un <select> con este valor
}
```
Sustituir el tipo fantasma `integer_number` por `integer` real (emite
`step="1"` y valida entero). Migrar su único uso, `constructionCatalog.ts`
línea 66, y quitar el remapeo manual de la línea 267.

### C.3 — Validación de cliente en `formFields.ts`

```ts
export interface FieldError { key: string; message: string }
export function validateFields(fields: FieldSpec[], root: ParentNode): FieldError[];
export function paintFieldErrors(errors: FieldError[], root: ParentNode): void;
export function clearFieldErrors(root: ParentNode): void;
```
`paintFieldErrors` marca el `<label>` culpable y pinta el mensaje junto al
campo (no en un `<p>` gris al final del modal), y hace scroll al primero.
Regla dura: **la validación de cliente nunca sustituye a la del servidor**, es
solo para acortar el bucle de retroalimentación.

### C.4 — `buildPayload()`: resolver "no tocar" vs "borrar"

```ts
export function buildPayload(fields: FieldSpec[], root: ParentNode): Record<string, unknown>;
// emptyMeans:'omit' → la clave NO se incluye  (el servicio con !== undefined no toca)
// emptyMeans:'null' → la clave va con null    (el servicio con !== undefined borra)
```
Sustituye el `for (const f of fields) payload[f.key] = readField(f, panel)`
repetido en todos los catálogos. Es la generalización del bug de
`resource_type` ya corregido: hace explícito en la spec un acoplamiento que
hoy es implícito entre capas.

### C.5 — Endurecer `openCatalogForm()` (`catalogModal.ts`)

- Llamar a `validateFields` antes del submit; abortar y pintar si hay errores.
- **Deshabilitar el botón durante el guardado** y rehabilitarlo al terminar
  (corta el doble submit).
- Al crear con éxito, cerrar el modal (hoy queda abierto e invita a duplicar).
- `role="status"` en el contenedor de estado.

### C.6 — Endurecer los widgets de filas (`catalogWidgets.ts`)

- `readIngredients`/`readDrops`/`readEquipment` devuelven
  `{ rows, invalidCount }` en vez de filtrar en silencio. El llamador avisa:
  *"Se ignoraron N filas incompletas"*, en vez de un "✅ Guardado" mentiroso.
- Detectar **duplicados** del mismo ítem y avisar antes de enviar (la UNIQUE de
  B.4 es la red de seguridad; esto es el aviso amable).
- `min="0"` y `required` en las cantidades.
- Prefijar `readIngredients` con `#ingredients-rows` (hoy consulta
  `.ingredient-row` a secas: si Construcciones ganara una sección de drops,
  recogería sus filas por error).
- Avisar si un `<select>` trae un valor que no está entre sus opciones (hoy
  muestra la primera en silencio y el guardado la pisa).

### C.7 — Migrar los catálogos al camino estandarizado

Orden sugerido, de menos a más complejo, **uno por commit**:
`terrainCatalog.ts` → `npcCatalog.ts` → `constructionCatalog.ts` →
`itemCatalog.ts` → `faccionCatalog.ts`. `effectCatalog.ts` ya está migrado y
sirve de referencia.

Para cada uno: sustituir el `panel.innerHTML` artesanal por secciones
declaradas con `FieldSpec[]` + `buildPayload` + `validateFields`, y unificar
los textos de estado ("Guardando…" / "✅ Guardado." / "❌ …") que hoy tienen
20+ variantes literales.

**No migrar en esta fase:** `mapCanvas.ts` (tiene su propio `selectHtml` y 8
formularios muy acoplados al canvas), `playerSheet.ts`, `mechanics.ts`,
`terminal.ts`. Son superficies distintas y su migración merece su propio plan.

---

## Archivos críticos

| Archivo | Fase |
|---|---|
| `src/mapServer/utils/handler.js` | A.1 |
| `src/mapServer/utils/dbErrors.js` (nuevo) | A.1 |
| `apps/web/src/scripts/api.ts` | A.2 |
| `src/services/productionService.js`, `constructionUseService.js`, `resourceGatherService.js`, `npcProductionService.js`, `constructionMaintenanceService.js` | A.3 |
| `src/services/worldIntegrityService.js` (nuevo) | B.2 |
| `src/mapServer/routes/worldIntegrity.js` (nuevo) + `src/mapServer.js` | B.3 |
| `apps/web/src/pages/index.astro`, `apps/web/src/scripts/adminTable.ts` | B.3 |
| `src/database/migrations/mysql/016_*.sql` (×2) + `src/database/migrate.js` | B.4 |
| `apps/web/src/scripts/html.ts` | C.1 |
| `apps/web/src/lib/formFields.ts` | C.2–C.4 |
| `apps/web/src/scripts/catalogModal.ts`, `catalogWidgets.ts` | C.5–C.6 |
| `apps/web/src/scripts/*Catalog.ts` | C.7 |

## Convenciones del repo a respetar

- **Cero comentarios nuevos** en el código (CLAUDE.md). Las explicaciones van
  al mensaje del commit.
- Finales de línea **LF**; normalizar cada archivo tocado antes de commitear.
- **Sin emojis en `apps/web/`** — usar `icon()` de `apps/web/src/lib/icons.ts`.
- Acceso a datos solo por `query`/`queryOne`/`execute`/`withTransaction`.
- Nombres de tabla cualificados vía el módulo `T` (`src/database/tables.js`).
- Una migración por cambio de esquema, registrada en `FILE_SCHEMA`; nunca
  editar una ya aplicada.
- **`git push` lo hace el usuario.** Dejar el trabajo en commits locales.

## Verificación

Por fase, antes de dar por buena cada una:

1. `npm run test:unit` y `npm run test:commands` (sin BD).
2. `npx tsc --noEmit -p .` + `npx astro check` + `npm run build` en `apps/web`.
3. `npm test` completo cuando haya MySQL con esquema limpio disponible
   (incluye `verify-gui-flows` y `verify-world-map`, cuyos recuentos fijos
   fallan con datos de una rehearsal previa).
4. Tests nuevos: uno por regla de integridad (Fase B) y uno por rama de
   `validateFields`/`buildPayload` (Fase C), con `test/helpers/mockDb.mjs`.
5. **Humo manual por fase:**
   - *A*: romper una columna a propósito → el panel dice "Error interno del
     servidor.", el stack solo en el log; parar MySQL → el panel dice "No se
     pudo contactar con el servidor", no "Failed to fetch".
   - *B*: borrar un ítem referenciado por una receta → aparece en Inicio y en
     la fila del catálogo; guardar esa receta → devuelve el aviso sin
     bloquear.
   - *C*: escribir `"` en un `display_name` y reabrir → el texto llega entero;
     dejar una fila de ingrediente a medias → avisa en vez de descartarla en
     silencio; pulsar Guardar dos veces seguidas → un solo POST.
