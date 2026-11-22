# Guía de despliegue

Cómo llevar este repositorio de "código en tu máquina" a "bot y panel web
corriendo en un servidor propio, con dominio y HTTPS". Pensada para un
servidor Linux con Docker — es como corre en producción hoy.

## Requisitos

- Un servidor con **Docker** y **Docker Compose v2** (`docker compose`, sin
  guion).
- Un **dominio propio** (o subdominio) que puedas apuntar por DNS al
  servidor — necesario porque Discord exige una URL pública HTTPS real para
  el redirect de OAuth2, no sirve una IP ni `localhost`.
- Un **reverse proxy con TLS**. `docker-compose.yml` está escrito para
  [Traefik](https://traefik.io) (usa sus labels `traefik.http.routers.*`
  directamente) — si no quieres usar Traefik, ver [§6](#6-desplegar-sin-traefik).
- Una **aplicación de Discord** ya creada — siguiente sección si no la
  tienes.

## 1. Crear la aplicación de Discord

1. [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application**.
2. **Bot** → *Reset Token* → copia el token (`DISCORD_TOKEN`). Activa los
   *Privileged Gateway Intents* que necesites (como mínimo, ninguno especial
   es obligatorio para los comandos actuales, pero revisa `src/index.js` si
   añades funcionalidad que dependa de contenido de mensajes o miembros).
3. **General Information** → copia el **Application ID** (`CLIENT_ID`).
4. **OAuth2** → *Reset Secret* → copia el **Client Secret**
   (`DISCORD_CLIENT_SECRET`) — es el login del panel web, distinto del token
   del bot.
5. **OAuth2 → Redirects** → añade
   `https://tu-dominio-del-mapa.com/auth/callback` (literal, con `/auth/callback`
   al final) — tiene que coincidir carácter a carácter con
   `MAP_SERVER_PUBLIC_URL` + `/auth/callback`.
6. **OAuth2 → URL Generator** → scope `bot` + `applications.commands`,
   permisos según lo que uses (mínimo: enviar mensajes, insertar enlaces,
   adjuntar archivos, gestionar canales — este último para que el modmail
   pueda crear canales privados). Abre la URL generada e invita el bot a tu
   servidor.
7. Activa el **modo desarrollador** de Discord (Ajustes → Avanzado) y
   copia con clic derecho sobre tu servidor su ID → `GUILD_ID`.

## 2. Preparar el `.env`

```bash
git clone <tu-fork-o-remoto> rpdiscbot
cd rpdiscbot
cp .env.example .env
```

Rellena `.env` variable por variable — cada una tiene un comentario
explicando de dónde sale. Puntos que no son obvios:

- **`GUILD_ID` es opcional para el bot** (sin él, los comandos se registran
  globales en vez de solo en tu servidor — hasta 1h de propagación en vez de
  instantáneo) **pero obligatorio para el panel web**: `rp-map-editor` no
  arranca sin él, porque lo usa para comprobar el rol Rolepriest del usuario
  que inicia sesión. Como `docker-compose.yml` siempre levanta ambos,
  rellénalo siempre.
- **`DB_USER` debe ser `propst`, no `root`** — ver el comentario del propio
  `.env.example`. `root` funciona para el bot (usa el driver `mysql2`, en
  JS puro) pero rompe las copias de seguridad en silencio (`mysqldump`
  necesita un usuario con `mysql_native_password`, que solo tiene el que
  crea `mysql-init/create-app-user.sh`).
- **Una sola `DB_PASSWORD`** hace de contraseña de root de MySQL y de
  contraseña del usuario `propst` — no hay una variable de contraseña de
  root aparte.
- **`NGINX_BASE_URL` y `MAP_SERVER_PUBLIC_URL`** tienen que ser URLs
  *públicas* de verdad (las que escribirías en un navegador desde fuera del
  servidor) — nunca `localhost` ni un nombre de servicio interno de Docker
  como `http://nginx/`. Si te equivocas aquí, el bot lo detecta y omite la
  miniatura en vez de romper el comando, pero no verás imágenes.
- **`MAP_SERVER_SESSION_SECRET`** — cualquier cadena larga aleatoria, p. ej.
  `openssl rand -hex 32`. Cambiarla desloguea a todo el mundo.

## 3. La red de Traefik

`docker-compose.yml` declara `traefik-net` como red **externa** — la deben
compartir tu Traefik y este proyecto, y Docker Compose no la crea sola:

```bash
docker network create traefik-net
```

(Si ya la creaste para otro proyecto en el mismo host, no hace falta
repetirlo — `docker network create` falla si ya existe, eso es normal.)

Si tu Traefik no tiene fijada una red por defecto (`--providers.docker.network`),
o corre en más de una red, cualquier servicio que esté en dos redes a la vez
**necesita** el label `traefik.docker.network=traefik-net` — si no, Traefik
elige una IP entre las disponibles sin ningún criterio fijo y puede acabar
enrutando a la red equivocada (nos pasó en producción: `/auth` y `/api`
colgados sin ni un error). `rp-map-editor`, `rp-web` y `nginx` ya llevan ese
label en este repo — solo importa si añades un servicio nuevo a dos redes.

## 4. Primer despliegue

```bash
docker compose up -d --build
```

Esto construye las dos imágenes propias (`rpdiscbot:latest` para bot y
map-editor, `rpdiscbot-web:latest` para el panel) y levanta los cinco
servicios. Automáticamente, sin que hagas nada más:

- MySQL crea los cuatro schemas (`rp_players`, `rp_world`, `rp_economy`,
  `rp_ops`) y aplica todas las migraciones de `src/database/migrations/mysql/`
  (`src/database/migrate.js`, tabla `rp_ops.schema_migrations`).
- `mysql-init/create-app-user.sh` crea el usuario `propst` (ver §2) — solo
  la primera vez que el volumen de datos de MySQL está vacío.
- El bot siembra un grid inicial de 100 casillas ("Llanura", de (0,0) a
  (9,9)) si el mapa está vacío.
- Bot y panel web **no bloquean su arranque** esperando a MySQL: si la BD
  tarda en estar lista, cualquiera que use la web o un comando ve un aviso
  de "la aplicación se está iniciando" en vez de un error, y todo empieza a
  responder normal en cuanto MySQL contesta (normalmente unos segundos).

## 5. Verificar que funciona

```bash
docker compose logs --tail=50 rp-disc-bot     # "Sesión iniciada como <bot>#0000"
docker compose logs --tail=50 rp-map-editor   # "✔ Escuchando en el puerto 3000"
docker compose ps                             # los 5 servicios "Up"
```

Entra a `https://tu-dominio-del-mapa.com` — deberías ver la pantalla de
login. Si el login con Discord falla o vuelve sin sesión, revisa que el
Redirect de OAuth2 (§1.5) coincida exactamente con `MAP_SERVER_PUBLIC_URL`.

## 6. Desplegar sin Traefik

Si no quieres un reverse proxy, expón los puertos directamente. Necesitas
un `docker-compose.override.yml` (Compose lo combina solo con el principal)
o editar `docker-compose.yml`:

```yaml
services:
  rp-web:
    ports: ["4321:4321"]
  rp-map-editor:
    ports: ["3000:3000"]     # solo si quieres pegar directo a la API, no obligatorio
  nginx:
    ports: ["8080:80"]
```

Y ajusta `.env`: `MAP_SERVER_PUBLIC_URL=http://tu-ip:4321` (el panel web
proxya `/auth` y `/api` hacia `rp-map-editor` internamente — no hace falta
exponer ese puerto para que el login funcione) y
`NGINX_BASE_URL=http://tu-ip:8080`. Sin TLS, el redirect de OAuth2 de
Discord también debe ser `http://` en vez de `https://`. La red
`traefik-net` sigue haciendo falta igualmente (`docker network create
traefik-net`) aunque no la use ningún proxy real — es solo la red que
`docker-compose.yml` espera que exista.

## 7. Redeploys posteriores

```bash
git pull
docker compose up -d --build
```

**Actualiza siempre el mismo directorio** con `git pull` — nunca hagas un
`git clone` fresco en un directorio nuevo ni un `rsync --delete`. Los datos
(`/media/raid/...` en producción, o `./data` si usas bind mounts locales)
no viven dentro de la imagen ni del propio repo, así que un `git pull`
normal nunca los toca — pero un clon limpio en otra carpeta sí te deja sin
ellos hasta que apuntes los mounts al sitio correcto. Ver
[docs/migration.md](migration.md) para mover datos de un servidor a otro
a propósito.

## 8. CI/CD (opcional)

Este repo incluye un `Jenkinsfile` propio con snapshot de la imagen
anterior, build, tests, deploy y health-check con **rollback automático** si
algo falla al arrancar — pensado para la infraestructura Jenkins de este
proyecto en concreto (nombres de imagen e integraciones ya configurados ahí
como variables de entorno de Jenkins), no algo que necesites para
autoalojar esto. Si tienes tu propio Jenkins/GitHub Actions/lo que sea, los
tres pasos que de verdad importan son `docker compose build`, `npm test`, y
`docker compose up -d --build`.

## Problemas comunes

- **`network traefik-net declared as external, but could not be found`** —
  te falta el paso de §3: `docker network create traefik-net`.
- **La web tarda unos segundos en responder tras un `up -d`** — normal, es
  el aviso de "aplicación iniciándose" mientras MySQL arranca (§4). Si dura
  más de medio minuto, mira `docker compose logs rpbot-bd`.
- **Los backups fallan pero el bot funciona bien** — casi seguro `DB_USER`
  está en `root` en vez de `propst` (§2). El bot usa el driver `mysql2` (sin
  problema con `root`), pero `mysqldump` no.
- **Las imágenes (avatares, miniaturas) no cargan en Discord** —
  `NGINX_BASE_URL`/`MAP_SERVER_PUBLIC_URL` apuntan a algo que Discord no
  puede alcanzar desde fuera (`localhost`, un hostname interno de Docker).
  Ver §2.
