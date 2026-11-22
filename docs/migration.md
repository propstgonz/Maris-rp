# Migraciones y traslado de datos

Dos cosas distintas conviven bajo "migración" en este repo — este documento
cubre ambas:

1. **Migraciones de esquema**: cambios versionados a la estructura de las
   tablas de MySQL, aplicados automáticamente al arrancar.
2. **Migrar datos**: mover la base de datos y el bucket de imágenes de un
   servidor a otro, o restaurar un backup.

## 1. Migraciones de esquema

Viven en `src/database/migrations/mysql/*.sql`, un fichero por cambio,
numerados (`001_rp_players.sql`, `002_rp_world.sql`, ...). El runner
(`src/database/migrate.js`, invocado desde `src/database/index.js` en cada
arranque del bot y del panel web) hace lo siguiente:

1. Crea los cuatro schemas si no existen (`rp_players`, `rp_world`,
   `rp_economy`, `rp_ops`).
2. Crea `rp_ops.schema_migrations` si no existe — una fila por fichero ya
   aplicado.
3. Recorre los ficheros `.sql` en orden alfabético; el que ya tenga fila en
   `schema_migrations` se salta.
4. Para cada fichero pendiente: hace `USE` del schema que le corresponde,
   ejecuta sus sentencias una a una, y registra la fila.

**El paso que se olvida fácil**: qué schema le toca a cada fichero no se
deduce del nombre — está en un mapa explícito dentro de `migrate.js`:

```js
const FILE_SCHEMA = {
  '001_rp_players.sql': SCHEMAS.players,
  '002_rp_world.sql':   SCHEMAS.world,
  // ...
};
```

**Para añadir una migración nueva**:

1. Crea `NNN_descripcion.sql` en `src/database/migrations/mysql/` con el
   siguiente número — nunca edites un fichero ya aplicado (ni en producción
   ni en tu propia rama; si aplicaste uno mal, el arreglo es un fichero
   nuevo, no editar el viejo).
2. Añade su entrada a `FILE_SCHEMA` en `migrate.js` apuntando al schema que
   le toque. Sin esto, el runner explota con `USE undefined`.
3. Si la tabla afectada tiene su nombre cualificado centralizado en
   `src/database/tables.js` (módulo `T`), añade ahí la entrada nueva
   también.
4. `docker compose up -d --build` (o simplemente reiniciar el contenedor si
   no cambiaste código) aplica la migración sola al arrancar.

No hay comando de "rollback" de migraciones — si una migración nueva resulta
mala, la solución es otra migración nueva que deshaga el cambio, igual que
cualquier historial de esquema versionado.

## 2. Mover el proyecto a un servidor nuevo

El mecanismo es literalmente el mismo que las copias de seguridad
automáticas ([BACKUPS.md](../BACKUPS.md)) — no hay una herramienta aparte
para "migrar": generar un backup ya te deja todo lo que necesitas para
reconstruir el juego en otra parte, en un solo fichero.

1. **Genera un backup fresco** en el servidor origen — desde la web
   (`/backups` → "Generar ahora") o `POST /api/backups/run` autenticado.
   Produce un único `roleplay-<timestamp>.zip` en `data/backups/` (o
   `BACKUP_DIR`) con `database.sql` (los cuatro schemas de MySQL) y
   `bucket/` (avatares, miniaturas de ítems/construcciones/NPCs) dentro.
2. **Copia ese fichero** al servidor nuevo (`scp`, `rsync`, lo que uses).
3. **Prepara el servidor nuevo** siguiendo [docs/deploy.md](deploy.md) hasta
   el paso 3 (red de Traefik creada, `.env` relleno) — pero **todavía no**
   arranques `rpbot-bd` con datos, o tendrás que vaciar el volumen antes de
   restaurar.
4. **Restaura** la copia — pasos completos en
   [BACKUPS.md § Restaurar](../BACKUPS.md#restaurar-un-backup). En resumen:
   `unzip`, luego `mysql < database.sql` para la base de datos y copiar
   `bucket/` sobre su punto de montaje.
5. Arranca el resto de servicios (`docker compose up -d --build`) y
   verifica login + mapa como en
   [docs/deploy.md § Verificar](deploy.md#5-verificar-que-funciona).

Si el servidor origen sigue vivo durante la migración, para el bot y el
panel web ahí (`docker compose stop rp-disc-bot rp-map-editor`) antes del
paso 1, para que el backup capture un estado consistente sin escrituras a
mitad de copia — `mysqldump --single-transaction` (que ya usa
`backupService.js`) hace esto innecesario para la parte de MySQL en sí, pero
el bucket de imágenes no tiene ese lujo si algo escribe una miniatura nueva
justo mientras se empaqueta.

## 3. Restaurar sin migrar de servidor

Mismo fichero, mismo procedimiento, en el mismo servidor — por
ejemplo para deshacer un cambio de datos accidental. Ver
[BACKUPS.md § Restaurar](../BACKUPS.md#restaurar-un-backup).

## Nota histórica: la migración SQLite → MySQL

Este proyecto empezó sobre SQLite (`better-sqlite3`, un único fichero
`roleplay.db`) y se migró a MySQL en cuatro schemas — ver
[docs/plan.md](plan.md) para el razonamiento completo (por qué cuatro
schemas, por qué `AsyncLocalStorage` para las transacciones, por qué las FK
solo dentro de cada schema). Esa migración ya se ejecutó una vez en
producción y el script puntual que volcaba la SQLite a MySQL tabla a tabla
se retiró del repo tras usarse — no hace falta conservarlo porque no hay
ninguna instalación de este proyecto que siga corriendo sobre SQLite. Si
algún día hiciera falta repetir algo parecido (otra fuente de datos externa,
por ejemplo), el patrón a seguir es el mismo: volcar 1:1 sin renombrar
nada, tabla a tabla, en orden de FK, y comparar recuentos de filas al
terminar.
