# rpdiscbot — Ricardana RP

Bot de Discord para un servidor de rol político-económico, más un panel web
de administración para el equipo de moderación ("Rolepriest"). Todo el
estado del mundo (jugadores, mapa, facciones, economía, construcciones) vive
en MySQL y es compartido en tiempo real entre el bot y la web.

## Qué es esto

- **Bot de Discord** (`src/`) — 30 slash commands. Personajes con HP/hambre,
  mapa persistente con viaje gradual por ticks, combate, crafteo,
  construcciones con salud/combustible/almacén, facciones con rangos y
  permisos cedibles, y un sistema de modmail que abre un canal privado por
  personaje.
- **Panel web** (`apps/web/`) — Astro SSR con look de terminal (fósforo verde
  sobre casi negro, monoespaciada). Login por Discord OAuth2, sin contraseña
  propia. Edición del mapa/catálogos para Rolepriest, y una vista pública de
  solo lectura del mapa (`/mapamundi`) para cualquier jugador.
- **API del mapa** (`src/mapServer.js`) — servidor Express que expone todo lo
  anterior por HTTP; el panel web nunca toca la base de datos directamente,
  siempre pasa por aquí (`fetch()` server-side).

## Arquitectura

```
Discord ──────────────┐
                       ▼
              ┌─────────────────┐        ┌──────────────────┐
              │  Bot (src/)      │        │  Panel web        │
              │  discord.js      │        │  apps/web/ (Astro)│
              └────────┬─────────┘        └─────────┬─────────┘
                       │                             │ fetch() SSR
                       ▼                             ▼
              ┌──────────────────────────────────────────────┐
              │  API del mapa — src/mapServer.js (Express)     │
              │  sesión + OAuth2 + CSRF + SSE (/api/events)     │
              └───────────────────────┬────────────────────────┘
                                       ▼
                    ┌──────────────────────────────────┐
                    │  MySQL — 4 schemas por dominio     │
                    │  rp_players · rp_world · rp_economy │
                    │  · rp_ops                            │
                    └──────────────────────────────────┘
```

Bot y API del mapa comparten la misma imagen Docker (`Dockerfile` en la
raíz) — solo cambia el comando de arranque. El panel web es una imagen
aparte (`apps/web/Dockerfile`) porque tiene su propio ciclo de build
(Astro/Vite). Un cuarto contenedor (`nginx`) sirve el bucket de imágenes
(avatares, miniaturas) como estático.

Cada esquema de MySQL es dueño de sus propias tablas y sus propias FK; las
relaciones que cruzan esquemas (p. ej. `inventory.item_id` → `rp_economy`
desde una fila de `rp_players`) se garantizan en la capa de aplicación, no
con una FK real — ver `src/database/tables.js` (módulo `T`, nombres de tabla
cualificados) y `src/database/index.js` (contrato `query`/`execute`/
`withTransaction`).

## Documentación

| Documento | Para quién |
|---|---|
| [docs/deploy.md](docs/deploy.md) | Desplegar esto de cero en un servidor propio |
| [docs/migration.md](docs/migration.md) | Mover a otro servidor, restaurar un backup, añadir una migración de esquema |
| [BACKUPS.md](BACKUPS.md) | Cómo y dónde se guardan las copias de seguridad (BD + bucket de imágenes) |
| [PLAYER_GUIDE.md](PLAYER_GUIDE.md) | Guía de jugador (también accesible en `/guia` del panel web y con `/ayuda` en Discord) |
| [docs/guia-staff.md](docs/guia-staff.md) | Guía única de Staff — mecánicas del mundo, comandos y recetas de configuración paso a paso (también accesible en `/docs` del panel web) |
| [CLAUDE.md](CLAUDE.md) | Estándares de ingeniería y arquitectura del repo (convenciones de código, diseño, permisos) |
| [docs/plan.md](docs/plan.md) | Historial de diseño: por qué el proyecto está construido como está (migración a MySQL, modelo de permisos, etc.) |

`MANUAL_STAFF.html` es una versión imprimible/exportable del manual de
Staff, independiente del panel web.

## Empezar en local

Requisitos: Node.js ≥ 22.3, Docker y Docker Compose, y una aplicación de
Discord ya creada (ver [docs/deploy.md](docs/deploy.md#1-crear-la-aplicación-de-discord)
para los pasos exactos si no tienes una).

```bash
cp .env.example .env        # y rellena los valores — ver comentarios de cada variable
npm install
npm install --prefix apps/web

# docker-compose.yml espera una red externa llamada "traefik-net" (los
# routers de rp-map-editor/rp-web/nginx la referencian por label) — sin
# esto "docker compose up" falla al arrancar aunque no tengas Traefik de
# verdad corriendo. Ver docs/deploy.md si quieres exponer los puertos
# directamente en vez de pasar por un reverse proxy.
docker network create traefik-net

docker compose up -d --build
```

Esto levanta los cinco servicios (`rpbot-bd`, `rp-disc-bot`, `rp-map-editor`,
`rp-web`, `nginx`) definidos en `docker-compose.yml`. Las migraciones de
esquema se aplican solas al arrancar — no hay que ejecutar nada a mano. Para
desarrollo del panel web con recarga en caliente:

```bash
npm run dev --prefix apps/web
```

Guía completa de despliegue en producción (dominio propio, Traefik,
variables de entorno una por una): [docs/deploy.md](docs/deploy.md).

## Tests

```bash
npm test              # unit + comandos + GUI + mapa del mundo + smoke
npm run test:unit     # solo unit (rápido, sin Docker)
```

El GUI y el mapa del mundo necesitan una MySQL con esquema limpio (solo
migraciones, sin datos de una ejecución anterior) — si no, sus recuentos
fijos fallan por datos ajenos, no por un bug real.

## Licencia

[MIT](LICENSE).
