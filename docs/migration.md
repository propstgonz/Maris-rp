# Migraciones y traslado de datos

Dos cosas distintas conviven bajo "migración" en este repo; este documento cubre ambas:

1. **Migraciones de esquema**: cambios versionados a la estructura y a los catálogos de MySQL, aplicados automáticamente al arrancar.
2. **Migrar datos**: mover la base de datos y el bucket de imágenes de un servidor a otro, o restaurar un backup.

## 1. Migraciones de esquema

Viven en `src/database/migrations/mysql/*.sql`, un fichero por cambio, numerados (`001_rp_players.sql`, `002_rp_world.sql`, ... `041_rp_players_drop.sql`). El runner (`src/database/migrate.js`, invocado desde `src/database/index.js` en cada arranque del bot y de la API) hace lo siguiente:

1. Abre una conexión dedicada y toma el bloqueo `GET_LOCK('rp_migrations')`, esperando hasta 600 s. Bot y API arrancan a la vez y migran los dos; el bloqueo hace que solo uno aplique cambios y el otro vea después todo ya registrado. El bloqueo se libera siempre al terminar.
2. Crea los cuatro schemas si no existen (`rp_players`, `rp_world`, `rp_economy`, `rp_ops`).
3. Crea `rp_ops.schema_migrations` si no existe: una fila por fichero ya aplicado.
4. Recorre los ficheros `.sql` en orden alfabético; el que ya tenga fila se salta.
5. Para cada fichero pendiente: hace `USE` del schema que le corresponde, ejecuta sus sentencias una a una y registra la fila.

**El schema se deduce del nombre del fichero**: `NNN_rp_<schema>_<tema>.sql` con `<schema>` en `players`, `world`, `economy` u `ops`. Un nombre que no case con ese patrón hace fallar el arranque con «Nombre de migración no válido». No hay ningún mapa que mantener.

**Para añadir una migración nueva**:

1. Crea `NNN_rp_<schema>_<tema>.sql` con el siguiente número. **Nunca edites un fichero ya aplicado**, ni en producción ni en tu rama: si una migración salió mal, el arreglo es otra migración.
2. Las sentencias se separan en `;` seguido de salto de línea. Ningún texto de datos puede acabar una línea con `;`.
3. Si añades una tabla, pon su nombre cualificado en `src/database/tables.js` (módulo `T`).
4. Los catálogos del Tomegrama (razas, menhires, escuelas, niveles, conjuros) se siembran con el texto literal del PDF. Un cambio de mecánica o de texto es una migración nueva con `UPDATE`, nunca una edición de la que lo sembró ni código de aplicación.
5. Reinicia el bot y la API (o `docker compose up -d --build`): la migración se aplica sola al arrancar.

No hay comando de "rollback": una migración mala se corrige con otra migración.

### Las migraciones 035 a 041

Convierten el juego antiguo al modelo del Tomegrama:

- **035**: perfil (edad, raza, menhir, estadísticas), razas, menhires, matrimonios y solicitudes.
- **036**: escuelas, niveles de dominio, progreso, intentos y los 75 conjuros.
- **037**: NPCs con dueño a `player_npcs`, construcciones con constructor a `properties`, y las existencias de almacenes, mercados, combustible y herramientas al inventario del dueño.
- **038**: inventario decimal (`DECIMAL(14,2)`, truncando las cantidades antiguas a 2 decimales) y categorías de bienes.
- **039, 040, 041**: eliminan las tablas y columnas del mundo, la economía y los jugadores antiguos (mapa, facciones, laburo, recetas, mercado...). **Tras la 039 no hay vuelta atrás con la imagen anterior.**

Antes de aplicarlas a datos reales, ensáyalas con `npm run rehearse-migration` (ver [deploy.md](deploy.md#despliegue-del-rediseño) y el [README](../README.md#ensayo-de-migración)).

## 2. Mover el proyecto a un servidor nuevo

El mecanismo es el mismo que las copias de seguridad automáticas ([BACKUPS.md](../BACKUPS.md)): generar un backup deja todo lo necesario para reconstruir el juego en otra parte, en un solo fichero.

1. **Genera un backup fresco** en el servidor origen: desde el panel (Backups > "Generar ahora") o con `POST /api/backups/run` autenticado. Produce un `roleplay-<timestamp>.zip` en `data/backups/` (o `BACKUP_DIR`) con `database.sql` (los cuatro schemas) y `bucket/` (avatares).
2. **Copia ese fichero** al servidor nuevo.
3. **Prepara el servidor nuevo** siguiendo [deploy.md](deploy.md) hasta el paso 3 (red de Traefik creada, `.env` y `config.json` rellenos), pero **todavía no** arranques `maris-rpbot-bd` con datos.
4. **Restaura** la copia: [BACKUPS.md, Restaurar](../BACKUPS.md#restaurar-un-backup). En resumen: `unzip`, `mysql < database.sql` y copiar `bucket/` sobre su punto de montaje.
5. Arranca el resto (`docker compose up -d --build`) y verifica el login y `/staff` como en [deploy.md, Verificar](deploy.md#5-verificar-que-funciona).

Si el servidor origen sigue vivo, páralo antes del paso 1 (`docker compose stop maris-rp-disc-bot maris-rp-api`) para que el backup capture un estado consistente. `mysqldump --single-transaction` (el que usa `backupService.js`) ya hace innecesario parar para la parte de MySQL, pero el bucket de imágenes no tiene ese lujo si algo escribe un avatar justo mientras se empaqueta.

## 3. Restaurar sin migrar de servidor

Mismo fichero, mismo procedimiento, en el mismo servidor; por ejemplo para deshacer un cambio de datos accidental. Ver [BACKUPS.md, Restaurar](../BACKUPS.md#restaurar-un-backup).

## Nota histórica

El proyecto empezó sobre SQLite y pasó a MySQL en cuatro schemas; después el juego del mapa se sustituyó por el sistema de fichas del Tomegrama (ADR-01 y ADR-02 en [ADR.md](ADR.md)). Ninguna instalación corre ya sobre SQLite ni sobre el esquema anterior a la migración 035 sin pasar por ella.
