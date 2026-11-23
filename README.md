# rpdiscbot — fichas del Tomegrama

Bot de Discord que lleva las fichas de personaje del rol *El Tomegrama* (PICARDA, razas, menhires, matrimonio, tres inventarios y magia) y un panel web para el equipo de moderación, el **Rolepriest**. Las mecánicas salen de `PROMPT/El Tomegrama.pdf`; el bot guarda las fichas y aplica las reglas mecánicas, y el Rolepriest arbitra el resto.

Este repositorio es un rediseño: del bot antiguo solo se conservan la comunidad y el staff (modmail, imprenta, broadcast, `/dado`, auditoría, backups, terminal, `/kill` y `/revive`). El mapa, las facciones, el combate y la economía antiguos se eliminaron (ver [docs/ADR.md](docs/ADR.md), ADR-01 y ADR-02).

## Arquitectura

Tres procesos que solo comparten MySQL:

| Proceso | Entrada | Qué hace |
|---|---|---|
| Bot | `src/index.js` | Comandos slash, componentes, modmail, cron (backups, purga de personajes y del registro) |
| API | `src/apiServer.js` (`src/api/`) | Login con Discord OAuth2, endpoints del panel de staff, SSE `/api/events` |
| Web | `apps/web/` (Astro SSR) | Panel de staff; solo habla con la API por `fetch()` server-side |

En Docker el bot y la API comparten imagen (`Dockerfile` de la raíz) y la web tiene la suya (`apps/web/Dockerfile`). Un contenedor `nginx` sirve el bucket de imágenes (avatares) y `rpbot-bd` es la MySQL.

MySQL va en cuatro schemas por dominio (`rp_players`, `rp_world`, `rp_economy`, `rp_ops`); las migraciones se aplican solas al arrancar. Detalle en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Requisitos

- Node.js 22.3 o superior y npm.
- Docker y Docker Compose v2 (para la pila completa y para la MySQL de pruebas).
- MySQL 8 (la imagen `mysql:8` del compose; fuera de Docker, una MySQL 8 propia con `mysql_native_password` habilitado si quieres backups).
- Un reverse proxy **Traefik** externo con la red Docker `traefik-net` si usas el `docker-compose.yml` tal cual. Sin Traefik, ver [docs/deploy.md](docs/deploy.md#6-desplegar-sin-traefik).
- Un dominio con HTTPS: Discord exige una URL pública real para el redirect de OAuth2.
- Una aplicación de Discord (siguiente sección).

## Crear la aplicación de Discord

En el [Developer Portal](https://discord.com/developers/applications):

- **New Application**. Copia el **Application ID** (`CLIENT_ID`).
- **Bot**: *Reset Token* (`DISCORD_TOKEN`) y activa los **Privileged Gateway Intents** *Server Members Intent* y *Message Content Intent*. El bot arranca con los intents `Guilds`, `GuildMembers`, `GuildMessages`, `MessageContent` y `DirectMessages`; sin los dos privilegiados no inicia sesión.
- **OAuth2**: *Reset Secret* (`DISCORD_CLIENT_SECRET`, distinto del token) y en **Redirects** añade `<API_PUBLIC_URL>/auth/callback`, idéntico carácter a carácter. El login pide solo el scope `identify`.
- **OAuth2 > URL Generator**: scopes `bot` y `applications.commands`; permisos de enviar mensajes, insertar enlaces, adjuntar archivos y **gestionar canales** (el modmail y los periódicos crean canales). Invita el bot a tu servidor.
- En Discord, activa el modo desarrollador (Ajustes > Avanzado) y copia con el botón derecho el ID del servidor (`GUILD_ID`), de los roles y de los canales para `config.json`.

## Configuración

### `.env`

Copia `.env.example` a `.env` (no se sube a Git). Todas las variables:

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DISCORD_TOKEN` | sí | Token del bot |
| `CLIENT_ID` | sí | Application ID; también es el Client ID del OAuth2 de la API |
| `GUILD_ID` | sí para la API | ID del servidor. La API lo usa para comprobar el rol de Rolepriest y sin él no arranca. Con él los comandos se registran solo en ese servidor (instantáneo); sin él, globales (hasta 1 h) |
| `AUTO_DEPLOY_COMMANDS` | no | `false` desactiva el registro automático de comandos al arrancar el bot |
| `DB_HOST`, `DB_PORT` | sí fuera de Docker | Host y puerto de MySQL. Con `docker-compose.yml` los fija el compose (`rpbot-bd:3306`) |
| `DB_USER` | sí | Usuario de aplicación. Usa `propst` (lo crea `mysql-init/create-app-user.sh`), no `root`: `mysqldump` de los backups falla con `root` |
| `DB_PASSWORD` | sí | Contraseña única: es la de root de MySQL en el compose y la de `propst` |
| `NGINX_BASE_URL` | sí | URL pública del bucket de imágenes (avatares). Nunca `localhost` ni un hostname interno de Docker; si está mal, el bot omite las miniaturas |
| `LOG_LEVEL` | no | `error`, `warn`, `info` (por defecto) o `debug` |
| `BACKUP_CRON` | no | Cron de los backups, en UTC. Por defecto `30 23 * * *`; se puede cambiar en caliente desde el panel |
| `BACKUP_RETENTION` | no | Copias que se conservan. Por defecto 7 |
| `BACKUP_DIR` | no | Carpeta de las copias. Por defecto `./data/backups` |
| `STAFF_ALERTS_CHANNEL_ID` | no | Canal donde el bot avisa de fallos operativos (un backup fallido, un `warn` o un `error`) |
| `MODMAIL_CATEGORY_ID` | no | Primera categoría de Discord para los canales privados de personaje. Más categorías: `/modmail-categoria crear` |
| `NEWSPAPER_CATEGORY_ID` | no | Categoría de los canales-periódico, solo si no se fijó con `/periodico categoria` |
| `CONFIG_PATH` | no | Ruta de `config.json`. Por defecto `./config.json` |
| `DISCORD_CLIENT_SECRET` | sí para la API | Client Secret del OAuth2 |
| `API_PUBLIC_URL` | sí para la API | URL pública del panel, sin barra final (por ejemplo `https://rp-map.tudominio.com`) |
| `API_SESSION_SECRET` | sí para la API | Cadena larga y aleatoria que firma la cookie de sesión (`openssl rand -hex 32`). Cambiarla cierra todas las sesiones |

La API también lee `API_PORT` (por defecto 3000, lo fija el compose) y `BUCKET_DIR` (por defecto `/app/bucket`). La web usa `API_INTERNAL_URL` (la URL interna de la API; en el compose es `http://rp-api:3000`).

### `config.json`

Roles y canales de tu servidor, en el formato del `config.json` de la raíz:

- `roles.staff`: lista de IDs de rol que son **Rolepriest**. Es el único nivel de moderación.
- `roles.player`: IDs de rol de jugador.
- `roles.characterCreated`: rol que el bot da al crear un personaje.
- `channels.logs`, `channels.announcements` (donde `/kill` anuncia) y `channels.transactions`.
- `images`: rutas de las carpetas de imágenes dentro del contenedor (`avatarsHostPath`, etc.).

En Docker se monta como volumen de solo lectura: cambiarlo no exige reconstruir la imagen, pero sí reiniciar el bot y la API.

## Arrancar

### En local

```bash
cp .env.example .env
npm install
npm install --prefix apps/web
```

Necesitas una MySQL accesible con los `DB_*` de tu `.env` (la de pruebas de más abajo sirve, por ejemplo en el puerto 3399). Después:

```bash
npm start                                  # el bot
npm run api                                # la API
npm run dev --workspace=apps/web           # el panel con recarga en caliente
```

Los comandos slash se registran solos al arrancar el bot. Para registrarlos a mano: `npm run deploy-commands`.

### Con Docker

```bash
docker network create traefik-net          # una vez, si no existe
docker compose up -d --build
```

Levanta cinco servicios: `rpbot-bd` (MySQL 8), `rp-disc-bot`, `rp-api`, `rp-web` y `nginx`. Para producción (dominio, Traefik, puntos de montaje) sigue [docs/deploy.md](docs/deploy.md).

### Catálogo opcional del Tomegrama

`npm run seed:tomegrama` inserta (por nombre, de forma idempotente) los bienes y edificios que nombra el PDF: Parque, Hotel, Alcantarillado, Academia, Laboratorio, Caña de Pescar y los demás. No se ejecuta solo, para no duplicar un catálogo ya trabajado a mano. En el servidor: `docker compose exec rp-disc-bot npm run seed:tomegrama`.

## Tests

```bash
npm test                  # test:unit + test:commands + test:smoke
npm run test:unit         # unitarios, con la BD mockeada (no necesita MySQL)
npm run test:commands     # carga y valida las definiciones de los comandos
npm run test:smoke        # arranca la API contra una MySQL y aplica las migraciones
npm run test:integration  # servicios contra una MySQL real, incluida la concurrencia
```

El smoke y la integración necesitan una MySQL. Para las pruebas usa una desechable, nunca la de producción:

```bash
docker run -d --name rp-test-mysql -e MYSQL_ROOT_PASSWORD=testpw -p 3399:3306 mysql:8 --mysql-native-password=ON
DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw npm test
DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw npm run test:integration
```

`test:integration` **borra los cuatro schemas** al empezar y se niega a correr contra los puertos 3306 y 3307 (salvo `INTEGRATION_ALLOW_ANY_PORT=1`). Por defecto usa `127.0.0.1:3399`, `root` y `testpw`. `npm test` no la incluye a propósito: es lo que se ejecuta en máquinas donde solo hay una MySQL de desarrollo.

### Ensayo de migración

Las migraciones 035 a 041 convierten un servidor del juego antiguo al modelo actual. Antes de aplicarlas a datos reales, ensáyalas:

```bash
DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw npm run rehearse-migration
DB_HOST=127.0.0.1 DB_PORT=3399 DB_USER=root DB_PASSWORD=testpw npm run rehearse-migration -- --current
```

- Sin argumentos (**modo fixture**): borra los schemas, aplica hasta la 034, siembra un juego antiguo con casos límite, migra y comprueba cifra por cifra que no se pierde ningún bien con dueño. Solo corre contra el puerto 3399 (o con `REHEARSAL_ALLOW_ANY_PORT=1`).
- Con `--current`: usa la base que ya hay (por ejemplo una copia de producción restaurada en una MySQL desechable), mide las existencias por fuente, aplica las migraciones pendientes y cuadra las cifras. **Aplica las migraciones sobre esa base**, así que nunca la apuntes a producción.

El runbook completo está en [docs/deploy.md](docs/deploy.md#despliegue-del-rediseño).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/deploy.md](docs/deploy.md) | Despliegue en un servidor propio y runbook del rediseño |
| [docs/migration.md](docs/migration.md) | Migraciones de esquema, mover de servidor y restaurar |
| [BACKUPS.md](BACKUPS.md) | Copias de seguridad: qué guardan, cuándo y cómo restaurar |
| [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) | Procesos, modelo de datos y contratos de los servicios |
| [docs/COMANDOS.md](docs/COMANDOS.md) | Todos los comandos slash: opciones, permisos y respuestas |
| [docs/ADR.md](docs/ADR.md) | Decisiones de diseño e interpretaciones del Tomegrama |
| [docs/TRAZABILIDAD.md](docs/TRAZABILIDAD.md) | Mecánica del PDF, implementación y pruebas |
| [docs/guia-staff.md](docs/guia-staff.md) | Guía de Staff para Rolepriest; es la única guía de Staff y el panel la sirve en `/staff/docs` |
| [PLAYER_GUIDE.md](PLAYER_GUIDE.md) | Guía del jugador |
| [CLAUDE.md](CLAUDE.md) | Estándares de ingeniería del repo |

El antiguo `MANUAL_STAFF.html` se eliminó: describía el juego anterior y duplicaba la guía de Staff. La guía vigente es `docs/guia-staff.md`.

## Licencia

[MIT](LICENSE).
