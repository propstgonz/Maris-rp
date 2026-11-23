# Guía de despliegue

Cómo llevar este repositorio de "código en tu máquina" a "bot y panel web corriendo en un servidor propio, con dominio y HTTPS". Pensada para un servidor Linux con Docker, que es como corre en producción.

Si ya tienes el bot antiguo en producción y vas a pasar al rediseño, lee antes [Despliegue del rediseño](#despliegue-del-rediseño): hay pasos que no se pueden saltar.

## Requisitos

- Un servidor con **Docker** y **Docker Compose v2** (`docker compose`, sin guion).
- Un **dominio propio** (o subdominio) apuntado por DNS al servidor: Discord exige una URL pública HTTPS real para el redirect de OAuth2, no sirve una IP ni `localhost`.
- Un **reverse proxy con TLS**. `docker-compose.yml` está escrito para [Traefik](https://traefik.io) (usa sus labels `traefik.http.routers.*`). Si no quieres Traefik, ver [§6](#6-desplegar-sin-traefik).
- Una **aplicación de Discord** ya creada; los pasos están en la sección siguiente y en el [README](../README.md#crear-la-aplicación-de-discord).

## 1. Crear la aplicación de Discord

1. [Discord Developer Portal](https://discord.com/developers/applications) > **New Application**.
2. **Bot** > *Reset Token*: copia el token (`DISCORD_TOKEN`). Activa los *Privileged Gateway Intents* **Server Members Intent** y **Message Content Intent**: el bot los pide (`GuildMembers` y `MessageContent`) y sin ellos no inicia sesión.
3. **General Information**: copia el **Application ID** (`CLIENT_ID`).
4. **OAuth2** > *Reset Secret*: copia el **Client Secret** (`DISCORD_CLIENT_SECRET`). Es el login del panel web y es distinto del token del bot.
5. **OAuth2 > Redirects**: añade `https://tu-dominio-del-panel.com/auth/callback`, literal, con `/auth/callback` al final. Tiene que coincidir carácter a carácter con `API_PUBLIC_URL` más `/auth/callback`.
6. **OAuth2 > URL Generator**: scopes `bot` y `applications.commands`; permisos de enviar mensajes, insertar enlaces, adjuntar archivos y **gestionar canales** (el modmail y los periódicos crean canales privados). Abre la URL generada e invita el bot a tu servidor.
7. Activa el **modo desarrollador** de Discord (Ajustes > Avanzado) y copia con el botón derecho el ID de tu servidor (`GUILD_ID`), de los roles de Rolepriest y de los canales que vayas a poner en `config.json`.

## 2. Preparar el `.env` y `config.json`

```bash
git clone <tu-fork-o-remoto> rpdiscbot
cd rpdiscbot
cp .env.example .env
```

Rellena `.env` variable por variable; la tabla completa está en el [README](../README.md#env). Puntos que no son obvios:

- **`GUILD_ID` es opcional para el bot** (sin él, los comandos se registran globales: hasta 1 h de propagación) **pero obligatorio para la API**: `rp-api` no arranca sin él porque lo usa para comprobar el rol de Rolepriest. Como el compose levanta siempre ambos, rellénalo.
- **`DB_USER` debe ser `propst`, no `root`.** `root` funciona para el bot (driver `mysql2`) pero rompe las copias de seguridad en silencio: `mysqldump` necesita un usuario con `mysql_native_password`, que es el que crea `mysql-init/create-app-user.sh` la primera vez que el volumen de MySQL está vacío.
- **Una sola `DB_PASSWORD`** hace de contraseña de root de MySQL y de la del usuario `propst`.
- **`NGINX_BASE_URL` y `API_PUBLIC_URL`** tienen que ser URLs públicas de verdad, nunca `localhost` ni un nombre de servicio interno de Docker. Si `NGINX_BASE_URL` está mal el bot omite las miniaturas.
- **`API_SESSION_SECRET`**: cadena larga aleatoria (`openssl rand -hex 32`). Cambiarla cierra las sesiones de todos.

Edita `config.json` con los IDs reales: `roles.staff` (los roles de Rolepriest), `roles.player`, `roles.characterCreated` y los canales. Solo existen esas claves de `roles`: un `config.json` antiguo con `mapPriest` o `game` se ignora, pero los IDs que estuvieran solo en `mapPriest` hay que pasarlos a `staff` (ver el runbook).

## 3. La red de Traefik

`docker-compose.yml` declara `traefik-net` como red **externa**: la deben compartir tu Traefik y este proyecto, y Compose no la crea sola.

```bash
docker network create traefik-net
```

(Si ya existe, `docker network create` falla; es normal.)

Si tu Traefik no fija una red por defecto (`--providers.docker.network`), cualquier servicio en dos redes necesita el label `traefik.docker.network=traefik-net`; si no, Traefik puede enrutar a la red equivocada y `/auth` y `/api` se cuelgan sin error. `rp-api`, `rp-web` y `nginx` ya lo llevan.

## 4. Primer despliegue

```bash
docker compose up -d --build
```

Construye las dos imágenes propias (`rpdiscbot:latest` para el bot y la API, `rpdiscbot-web:latest` para el panel) y levanta los cinco servicios: `rpbot-bd`, `rp-disc-bot`, `rp-api`, `rp-web` y `nginx`. Sin que hagas nada más:

- El bot y la API aplican las migraciones de `src/database/migrations/mysql/` al arrancar (`src/database/migrate.js`, tabla `rp_ops.schema_migrations`). Arrancan a la vez, así que el runner toma un bloqueo (`GET_LOCK('rp_migrations')`): el segundo proceso espera a que el primero termine y no repite nada.
- `mysql-init/create-app-user.sh` crea el usuario `propst`, solo la primera vez que el volumen de datos está vacío.
- Bot y panel no bloquean su arranque esperando a MySQL: mientras la BD tarda en estar lista se muestra un aviso de "la aplicación se está iniciando".
- El catálogo de razas, menhires, escuelas, niveles y los 75 conjuros viene en las propias migraciones.
- Opcional: `docker compose exec rp-disc-bot npm run seed:tomegrama` carga los bienes y edificios que nombra el PDF.

## 5. Verificar que funciona

```bash
docker compose logs --tail=50 rp-disc-bot     # "Bot conectado como <bot>#0000"
docker compose logs --tail=50 rp-api          # "[API] Escuchando en el puerto 3000"
docker compose ps                             # los 5 servicios "Up"
```

Entra a `https://tu-dominio-del-panel.com`: verás la pantalla de login. Si el login con Discord falla o vuelve sin sesión, revisa que el Redirect de OAuth2 (§1.5) coincida exactamente con `API_PUBLIC_URL`. Dentro del contenedor, `/api/me` sin sesión debe responder 401.

## 6. Desplegar sin Traefik

Expón los puertos directamente con un `docker-compose.override.yml` (Compose lo combina solo) o editando `docker-compose.yml`:

```yaml
services:
  rp-web:
    ports: ["4321:4321"]
  rp-api:
    ports: ["3000:3000"]
  nginx:
    ports: ["8080:80"]
```

Ajusta `.env`: `API_PUBLIC_URL=http://tu-ip:4321` (el panel proxya `/auth` y `/api` hacia `rp-api`, no hace falta exponer ese puerto para que el login funcione) y `NGINX_BASE_URL=http://tu-ip:8080`. Sin TLS, el redirect de OAuth2 también debe ser `http://`. La red `traefik-net` sigue haciendo falta (`docker network create traefik-net`) aunque no la use ningún proxy.

## 7. Redeploys posteriores

```bash
git pull
docker compose up -d --build
```

**Actualiza siempre el mismo directorio** con `git pull`: nunca un `git clone` nuevo ni `rsync --delete`. Los datos (`/media/raid/...` en producción) no viven en la imagen ni en el repo, pero un clon limpio en otra carpeta te deja sin ellos hasta que apuntes los montajes al sitio correcto. Para mover datos de un servidor a otro, ver [migration.md](migration.md).

Las migraciones nuevas se aplican solas al arrancar. Una migración que falla deja el proceso sin arrancar: mira `docker compose logs rp-disc-bot rp-api`.

## 8. CI/CD (Jenkins)

El `Jenkinsfile` hace, en este orden:

- **Preflight**: comprueba `.env`, `config.json`, `nginx/nginx.conf` y los directorios del RAID.
- **Snapshot previous image**: etiqueta las imágenes actuales como `:rollback`.
- **Build** de `rp-disc-bot` y `rp-web`.
- **Test**: levanta una MySQL desechable y ejecuta dentro de la imagen recién construida `npm test` y `npm run test:integration` (con `INTEGRATION_ALLOW_ANY_PORT=1`, porque la MySQL desechable escucha en el 3306 de su red privada).
- **Pre-deploy checks and backup**: exige `API_PUBLIC_URL` y `API_SESSION_SECRET` en el `.env`, y hace un `mysqldump` comprimido de los cuatro schemas en `/media/raid/database/rpbot/pre-deploy/` (conserva los 5 últimos) **antes** de tocar nada. Si el volcado falla, aborta.
- **Deploy**: `docker compose up -d --remove-orphans`, con rollback de imagen si el comando falla.
- **Health check**: bot conectado, la API respondiendo **401** a `/api/me` sin sesión y la web respondiendo. Si un contenedor se cae, rollback automático.

**El rollback de imagen no deshace migraciones.** Si la migración 039 ya se aplicó, la imagen anterior no funciona con la base nueva: hay que restaurar el volcado previo o el último backup.

## Despliegue del rediseño

Pasar del bot antiguo (mapa, facciones, economía) al sistema del Tomegrama es **irreversible desde el punto de vista de los datos**: las migraciones 037 a 041 mueven lo que tiene dueño a los tres inventarios y borran el resto. La 039 elimina las tablas del mundo antiguo; a partir de ahí, **el rollback de imagen no sirve: solo restaurar el backup**. Sigue este orden.

### 1. Backup completo antes de nada

El backup automático del bot corre al arrancar y a la hora del cron, es decir, **después** de migrar, así que no sirve como seguro. Hazlo a mano con el sistema antiguo todavía en marcha:

```bash
docker exec ricardana-rp-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases rp_players rp_world rp_economy rp_ops' > pre-rediseno.sql
```

Comprueba que el fichero pesa más que unos pocos KB y guárdalo fuera del servidor. Haz también un backup desde el panel antiguo si está disponible (incluye el bucket de imágenes).

### 2. Ensayo con una copia en una MySQL desechable

En una máquina con Node 22 y el repositorio ya en la versión nueva (nunca en producción):

```bash
docker run -d --name rp-rehearsal -e MYSQL_ROOT_PASSWORD=testpw -p 3399:3306 mysql:8 --mysql-native-password=ON
docker exec -i rp-rehearsal mysql -uroot -ptestpw < pre-rediseno.sql
npm ci
DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw npm run rehearse-migration -- --current
```

`--current` mide las existencias del juego antiguo por fuente (inventarios, almacenes de construcciones, NPCs y facciones, herramientas equipadas, stock de mercado, combustible y objetos del suelo), aplica las migraciones y comprueba que el inventario por (jugador, bien) es la suma de las fuentes con dueño truncada a 2 decimales. Debe terminar en `ENSAYO SUPERADO`. Revisa las cifras de «objetos en el suelo del mapa» y de construcciones sin constructor: es lo único que se pierde. Si algo no cuadra, **no despliegues**. Borra después el contenedor: `docker rm -f rp-rehearsal`.

### 3. Actualizar `.env` y `config.json` del servidor

- `.env`: renombra las variables `MAP_SERVER_*` a `API_*` (`MAP_SERVER_PUBLIC_URL` a `API_PUBLIC_URL`, `MAP_SERVER_SESSION_SECRET` a `API_SESSION_SECRET`; el puerto interno lo fija el compose con `API_PORT`). Añade las que falten de `.env.example`. El redirect de OAuth2 del Developer Portal no cambia mientras `API_PUBLIC_URL` valga lo mismo.
- `config.json`: quita las claves `mapPriest` y `game`. **Si algún ID de rol estaba solo en `mapPriest`, pásalo a `staff`**: es el único rol de moderación y ese ID perdería los permisos si no.
- El servicio `rp-map-editor` se llama ahora `rp-api`; `docker compose up -d --remove-orphans` retira el contenedor antiguo.

### 4. Desplegar

Con el Jenkinsfile (que hace su propio volcado previo) o a mano:

```bash
git pull
docker compose up -d --build --remove-orphans
```

Comprueba el [paso 5](#5-verificar-que-funciona) y que `/staff` carga. Prueba un `/perfil` con un jugador real.

### 5. Aviso: no hay vuelta atrás con la imagen

Tras aplicar la migración 039 **no vuelvas a la imagen anterior**: el código antiguo busca tablas que ya no existen. El único camino de vuelta es restaurar el backup del paso 1 ([BACKUPS.md](../BACKUPS.md#restaurar-un-backup)) con la imagen antigua. Por eso el ensayo del paso 2 es obligatorio.

## Problemas comunes

- **`network traefik-net declared as external, but could not be found`**: falta el paso de §3.
- **La web tarda unos segundos en responder tras un `up -d`**: es el aviso de "aplicación iniciándose" mientras MySQL arranca. Si dura más de medio minuto, mira `docker compose logs rpbot-bd`.
- **Los backups fallan pero el bot funciona**: casi seguro `DB_USER` está en `root` en vez de `propst` (§2).
- **Las imágenes no cargan en Discord**: `NGINX_BASE_URL` apunta a algo que Discord no puede alcanzar (`localhost`, un hostname interno).
- **El bot o la API se quedan esperando al arrancar**: otro proceso tiene el bloqueo de migraciones (`rp_migrations`). Espera a que termine; si el otro proceso murió, el servidor MySQL libera el bloqueo al cerrar su conexión.
- **El bot no inicia sesión (`Used disallowed intents`)**: falta activar *Server Members Intent* o *Message Content Intent* en el Developer Portal.
