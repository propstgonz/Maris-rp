# Copias de seguridad

Qué se guarda, dónde, cuándo, y cómo restaurar — base de datos MySQL y
bucket de imágenes, ambos cubiertos.

## Qué genera cada copia

`src/services/backupService.js#runBackup()` produce **un único fichero por
copia**: `roleplay-<timestamp>.zip`, con las dos cosas dentro.

```
roleplay-<timestamp>.zip
├── database.sql        volcado de mysqldump --single-transaction
└── bucket/             el bucket de imágenes entero
```

- `database.sql` — volcado de los cuatro schemas (`rp_players`, `rp_world`,
  `rp_economy`, `rp_ops`). Se escribe a un directorio temporal dentro de
  `BACKUP_DIR` y se borra en cuanto entra en el zip, pase lo que pase.
- `bucket/` — todo `/app/bucket` (montaje read-only de
  `/media/raid/bucket/rpdiscbot` completo, ver `docker-compose.yml`). Si ese
  montaje no existe en tu entorno (por ejemplo, en local sin bucket
  configurado), o si falla al empaquetarse, la copia se genera igual con
  solo la base de datos y queda avisado en el log.

Se guarda en `data/backups/` (o `BACKUP_DIR` si lo cambias) — dentro del
mismo bind mount que ya persiste `./data`, así que sobrevive a redeploys sin
tocar nada más.

El empaquetado usa el binario `zip`, que el `Dockerfile` del bot instala
junto a `mysql-client`.

### Copias del formato antiguo

Antes cada copia eran **dos** ficheros (`roleplay-<ts>.sql.gz` y
`roleplay-<ts>-bucket.tar.gz`). Las que ya existan siguen listándose y
descargándose con normalidad desde `/backups`, marcadas como "formato
antiguo", y la rotación las trata como una sola copia: cuando les toca
caducar se van las dos juntas. No hay que convertir nada.

## Cuándo se ejecuta

- Según el horario configurado — por defecto `30 23 * * *` (23:30 UTC
  diario, `BACKUP_CRON` en `.env` como valor de fábrica).
- **Configurable desde la web** sin reiniciar nada: `/backups` → campo de
  expresión cron + "Guardar horario". El bot reprograma el cron en caliente
  (revisa cada 60s si el valor cambió) — la variable de entorno solo es el
  valor inicial antes de que nadie lo cambie desde la web.
- **Bajo demanda**: botón "Generar ahora" en `/backups`, o
  `POST /api/backups/run` autenticado (Rolepriest). Útil antes de una
  migración a otro servidor (ver [docs/migration.md](docs/migration.md)) o
  antes de un cambio arriesgado.

## Rotación

Se conservan las `BACKUP_RETENTION` copias más recientes (por defecto 7).
Se cuentan **copias, no ficheros**: una copia del formato antiguo son sus dos
ficheros emparejados por timestamp, y caducan juntos — nunca queda un bucket
huérfano de una base de datos ya eliminada.

## Variables de entorno relevantes

Todas opcionales — ver comentarios completos en `.env.example`.

```
BACKUP_CRON=30 23 * * *        # valor de fábrica; la web lo sobreescribe en caliente
BACKUP_RETENTION=7
BACKUP_DIR=/app/data/backups
BUCKET_DIR=/app/bucket         # normalmente no hace falta tocarlo
```

## Restaurar un backup

Necesitas un solo fichero: el `.zip` de la copia.

**1. Para el bot y el panel** (evita escrituras a mitad de restauración):

```bash
docker compose stop rp-disc-bot rp-map-editor
```

**2. Descomprime la copia**:

```bash
unzip roleplay-<timestamp>.zip -d restauracion/
```

Quedan `restauracion/database.sql` y `restauracion/bucket/`.

**3. Restaura la base de datos** — el volcado incluye sus propios
`CREATE DATABASE`/`DROP TABLE IF EXISTS` por tabla, así que sobrescribe el
contenido de los cuatro schemas sin que tengas que vaciarlos a mano primero:

```bash
docker exec -i ricardana-rp-mysql mysql -u root -p"tu_DB_PASSWORD_del_.env" \
  < restauracion/database.sql
```

**4. Restaura el bucket de imágenes** — el contenido de `bucket/` va directo
al destino:

```bash
cp -a restauracion/bucket/. /media/raid/bucket/rpdiscbot/
```

**5. Vuelve a arrancar**:

```bash
docker compose up -d rp-disc-bot rp-map-editor
```

Por seguridad, antes del paso 2 puedes guardar aparte el estado actual con
un backup manual (`/backups` → "Generar ahora") — así el "antes de
restaurar" también queda como un backup normal, sin pasos especiales.

## Blindaje adicional: copia fuera del servidor

Todo lo anterior protege contra errores de despliegue, corrupción de datos y
reinicios — pero sigue siendo **el mismo disco**. Si el servidor entero se
pierde (disco roto, proveedor caído...), también se pierde `data/backups/`.
Para blindaje total, copia periódicamente esa carpeta fuera del servidor
(otro host, un bucket S3, etc.) — por ejemplo con `rsync`/`cron` a nivel de
sistema operativo, sin necesidad de tocar el bot. No implementado dentro del
proyecto porque depende de dónde decidas que viva ese destino externo.
