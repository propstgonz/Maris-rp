# Multietapa: `builder` instala TODAS las dependencias (incl. devDeps —
# astro/tailwind son build-time, no runtime) y compila; `runtime` copia
# solo `dist/` + las dependencias de PRODUCCIÓN (@astrojs/node, el único
# paquete que el server compilado necesita en pie) — la imagen final no
# lleva el compilador de Astro/Vite/Tailwind, solo el server ya construido.
# Ver docs/plan.md §2.5.
#
# node:22-alpine por consistencia con el Dockerfile de la raíz (bot/
# map-editor) — esta imagen no necesita compilar nada nativo, porque esta
# app nunca toca la BD directamente: todo pasa por fetch() a mapServer.js.
# Por eso no hace falta python3/make/g++ que sí lleva el de la raíz.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# @astrojs/node en modo "standalone" (ver astro.config.mjs) escucha él solo
# — ni Express ni ningún wrapper propio hace falta aquí.
CMD ["node", "dist/server/entry.mjs"]
