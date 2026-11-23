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
git clone <tu-fork-o-remoto> maris
cd maris
cp .env.example .env
```

Rellena `.env` variable por variable; la tabla completa está en el [README](../README.md#env). Puntos que no son obvios:

- **`GUILD_ID` es opcional para el bot** (sin él, los comandos se registran globales: hasta 1 h de propagación) **pero obligatorio para la API**: `maris-rp-api` no arranca sin él porque lo usa para comprobar el rol de Rolepriest. Como el compose levanta siempre ambos, rellénalo.
- **`DB_USER` debe ser `propst`, no `root`.** `root` funciona para el bot (driver `mysql2`) pero rompe las copias de seguridad en silencio: `mysqldump` necesita un usuario con `mysql_native_password`, que es el que crea `mysql-init/create-app-user.sh` la primera vez que el volumen de MySQL está vacío.
- **Una sola `DB_PASSWORD`** hace de contraseña de root de MySQL y de la del usuario `propst`.
- **`NGINX_BASE_URL` y `API_PUBLIC_URL`** tienen que ser URLs públicas de verdad, nunca `localhost` ni un nombre de servicio interno de Docker. Si `NGINX_BASE_URL` está mal el bot omite las miniaturas.
- **`API_SESSION_SECRET`**: cadena larga aleatoria (`openssl rand -hex 32`). Cambiarla cierra las sesiones de todos.
- **`PANEL_HOST` y `BUCKET_HOST`**: los dominios que Traefik enruta a este proyecto, sin protocolo (el host de `API_PUBLIC_URL` y el de `NGINX_BASE_URL`). Sin ellos `docker compose` se niega a arrancar.

Edita `config.json` con los IDs reales: `roles.staff` (los roles de Rolepriest), `roles.player`, `roles.characterCreated` y los canales. Solo existen esas claves de `roles`: un `config.json` antiguo con `mapPriest` o `game` se ignora, pero los IDs que estuvieran solo en `mapPriest` hay que pasarlos a `staff` (ver el runbook).

## 3. La red de Traefik

`docker-compose.yml` declara `traefik-net` como red **externa**: la deben compartir tu Traefik y este proyecto, y Compose no la crea sola.

```bash
docker network create traefik-net
```

(Si ya existe, `docker network create` falla; es normal.)

Si tu Traefik no fija una red por defecto (`--providers.docker.network`), cualquier servicio en dos redes necesita el label `traefik.docker.network=traefik-net`; si no, Traefik puede enrutar a la red equivocada y `/auth` y `/api` se cuelgan sin error. `maris-rp-api`, `maris-rp-web` y `maris-nginx` ya lo llevan.

## 4. Primer despliegue

```bash
docker compose up -d --build
```

Construye las dos imágenes propias (`maris-bot:latest` para el bot y la API, `maris-web:latest` para el panel) y levanta los cinco servicios: `maris-rpbot-bd`, `maris-rp-disc-bot`, `maris-rp-api`, `maris-rp-web` y `maris-nginx`. Sin que hagas nada más:

- El bot y la API aplican las migraciones de `src/database/migrations/mysql/` al arrancar (`src/database/migrate.js`, tabla `rp_ops.schema_migrations`). Arrancan a la vez, así que el runner toma un bloqueo (`GET_LOCK('rp_migrations')`): el segundo proceso espera a que el primero termine y no repite nada.
- `mysql-init/create-app-user.sh` crea el usuario `propst`, solo la primera vez que el volumen de datos está vacío.
- Bot y panel no bloquean su arranque esperando a MySQL: mientras la BD tarda en estar lista se muestra un aviso de "la aplicación se está iniciando".
- El catálogo de razas, menhires, escuelas, niveles y los 75 conjuros viene en las propias migraciones.
- Opcional: `docker compose exec maris-rp-disc-bot npm run seed:tomegrama` carga los bienes y edificios que nombra el PDF.

## 5. Verificar que funciona

```bash
docker compose logs --tail=50 maris-rp-disc-bot     # "Bot conectado como <bot>#0000"
docker compose logs --tail=50 maris-rp-api          # "[API] Escuchando en el puerto 3000"
docker compose ps                             # los 5 servicios "Up"
```

Entra a `https://tu-dominio-del-panel.com`: verás la pantalla de login. Si el login con Discord falla o vuelve sin sesión, revisa que el Redirect de OAuth2 (§1.5) coincida exactamente con `API_PUBLIC_URL`. Dentro del contenedor, `/api/me` sin sesión debe responder 401.

## 6. Desplegar sin Traefik

Expón los puertos directamente con un `docker-compose.override.yml` (Compose lo combina solo) o editando `docker-compose.yml`:

```yaml
services:
  maris-rp-web:
    ports: ["4321:4321"]
  maris-rp-api:
    ports: ["3000:3000"]
  nginx:
    ports: ["8080:80"]
```

Ajusta `.env`: `API_PUBLIC_URL=http://tu-ip:4321` (el panel proxya `/auth` y `/api` hacia `maris-rp-api`, no hace falta exponer ese puerto para que el login funcione) y `NGINX_BASE_URL=http://tu-ip:8080`. Sin TLS, el redirect de OAuth2 también debe ser `http://`. La red `traefik-net` sigue haciendo falta (`docker network create traefik-net`) aunque no la use ningún proxy.

## 7. Redeploys posteriores

```bash
git pull
docker compose up -d --build
```

**Actualiza siempre el mismo directorio** con `git pull`: nunca un `git clone` nuevo ni `rsync --delete`. Los datos (`/media/raid/...` en producción) no viven en la imagen ni en el repo, pero un clon limpio en otra carpeta te deja sin ellos hasta que apuntes los montajes al sitio correcto. Para mover datos de un servidor a otro, ver [migration.md](migration.md).

Las migraciones nuevas se aplican solas al arrancar. Una migración que falla deja el proceso sin arrancar: mira `docker compose logs maris-rp-disc-bot maris-rp-api`.

## 8. CI/CD (Jenkins)

El `Jenkinsfile` hace, en este orden:

- **Preflight**: comprueba `.env`, `config.json`, `nginx/nginx.conf` y los directorios del RAID.
- **Snapshot previous image**: etiqueta las imágenes actuales como `:rollback`.
- **Build** de `maris-rp-disc-bot` y `maris-rp-web`.
- **Test**: levanta una MySQL desechable y ejecuta dentro de la imagen recién construida `npm test` y `npm run test:integration` (con `INTEGRATION_ALLOW_ANY_PORT=1`, porque la MySQL desechable escucha en el 3306 de su red privada).
- **Pre-deploy checks and backup**: exige `API_PUBLIC_URL`, `API_SESSION_SECRET`, `PANEL_HOST` y `BUCKET_HOST` en el `.env`, y hace un `mysqldump` comprimido de los cuatro schemas en `/media/raid/database/maris/pre-deploy/` (conserva los 5 últimos) **antes** de tocar nada. Si el volcado falla, aborta.
- **Deploy**: `docker compose up -d --remove-orphans`, con rollback de imagen si el comando falla.
- **Health check**: bot conectado, la API respondiendo **401** a `/api/me` sin sesión y la web respondiendo. Si un contenedor se cae, rollback automático.

**El rollback de imagen no deshace migraciones.** Si la migración 039 ya se aplicó, la imagen anterior no funciona con la base nueva: hay que restaurar el volcado previo o el último backup.

## Despliegue del rediseño

El rediseño se despliega **en paralelo** al bot antiguo: proyecto Compose `maris`, contenedores `maris-rp-*`, imágenes `maris-bot`/`maris-web`, MySQL propia en el puerto 3308 y datos en `/media/raid/database/maris` y `/media/raid/bucket/maris`. El bot antiguo (`ricardana-rp-*`, puerto 3307, `/media/raid/database/rpbot`) no se toca: las migraciones 037 a 041, que son destructivas, solo se aplican sobre la copia que se carga en la MySQL nueva. Volver atrás es parar el proyecto `maris`.

### 1. Volcado del bot antiguo

Con el bot antiguo en marcha:

```bash
docker exec ricardana-rp-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --databases rp_players rp_world rp_economy rp_ops' > pre-rediseno.sql
```

Comprueba que el fichero pesa más que unos pocos KB y guárdalo también fuera del servidor.

### 2. Ensayo con una copia en una MySQL desechable

En una máquina con Node 22 y el repositorio ya en la versión nueva (nunca en producción):

```bash
docker run -d --name rp-rehearsal -e MYSQL_ROOT_PASSWORD=testpw -p 3399:3306 mysql:8 --mysql-native-password=ON
docker exec -i rp-rehearsal mysql -uroot -ptestpw < pre-rediseno.sql
npm ci
DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw npm run rehearse-migration -- --current
```

`--current` mide las existencias del juego antiguo por fuente (inventarios, almacenes de construcciones, NPCs y facciones, herramientas equipadas, stock de mercado, combustible y objetos del suelo), aplica las migraciones y comprueba que el inventario por (jugador, bien) es la suma de las fuentes con dueño truncada a 2 decimales. Debe terminar en `ENSAYO SUPERADO`. Revisa las cifras de «objetos en el suelo del mapa» y de construcciones sin constructor: es lo único que se pierde. Si algo no cuadra, **no despliegues**. Borra después el contenedor: `docker rm -f rp-rehearsal`.

### 3. `.env` y `config.json` del proyecto nuevo

Parte del `.env` del bot antiguo y cámbialo así:

- Renombra `MAP_SERVER_*` a `API_*` (`MAP_SERVER_PUBLIC_URL` a `API_PUBLIC_URL`, `MAP_SERVER_SESSION_SECRET` a `API_SESSION_SECRET`). Añade las que falten de `.env.example`.
- **Otra aplicación de Discord** (§1): `DISCORD_TOKEN`, `CLIENT_ID` y `DISCORD_CLIENT_SECRET` propios. Con el mismo token, los dos bots recibirían las mismas interacciones y el registro de comandos de uno borraría los del otro.
- **Otros dominios**: `PANEL_HOST`, `BUCKET_HOST`, `API_PUBLIC_URL` y `NGINX_BASE_URL` distintos de los del bot antiguo, con su redirect de OAuth2 en la aplicación nueva.

En `config.json` quita las claves `mapPriest` y `game`. **Si algún ID de rol estaba solo en `mapPriest`, pásalo a `staff`**: es el único rol de moderación.

### 4. Cargar los datos antiguos en la MySQL nueva

Antes del primer arranque del bot y la API (si arrancan con la base vacía crean el esquema desde cero y el volcado ya no encaja):

```bash
docker compose up -d maris-rpbot-bd
until docker exec maris-rp-mysql sh -c 'mysqladmin ping --protocol=tcp -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent'; do sleep 2; done
docker exec -i maris-rp-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"' < pre-rediseno.sql
cp -a /media/raid/bucket/rpdiscbot/. /media/raid/bucket/maris/
```

Si prefieres empezar con la base vacía, sáltate este paso.

### 5. Desplegar

Con el Jenkinsfile o a mano:

```bash
docker compose up -d --build --remove-orphans
```

El bot y la API aplican las migraciones 035 a 041 sobre la copia. Comprueba el [paso 5](#5-verificar-que-funciona) y que `/staff` carga. Prueba un `/perfil` con un jugador real.

## Problemas comunes

- **`network traefik-net declared as external, but could not be found`**: falta el paso de §3.
- **La web tarda unos segundos en responder tras un `up -d`**: es el aviso de "aplicación iniciándose" mientras MySQL arranca. Si dura más de medio minuto, mira `docker compose logs maris-rpbot-bd`.
- **Los backups fallan pero el bot funciona**: casi seguro `DB_USER` está en `root` en vez de `propst` (§2).
- **Las imágenes no cargan en Discord**: `NGINX_BASE_URL` apunta a algo que Discord no puede alcanzar (`localhost`, un hostname interno).
- **El bot o la API se quedan esperando al arrancar**: otro proceso tiene el bloqueo de migraciones (`rp_migrations`). Espera a que termine; si el otro proceso murió, el servidor MySQL libera el bloqueo al cerrar su conexión.
- **El bot no inicia sesión (`Used disallowed intents`)**: falta activar *Server Members Intent* o *Message Content Intent* en el Developer Portal.
